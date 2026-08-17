import {
  decodeErrorResult,
  getAddress,
  hexToBigInt,
  isAddressEqual,
  isHex,
  parseEventLogs,
  zeroAddress,
  erc20Abi,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from 'viem';
import { rareErc1155Abi } from '../contracts/abis/rare-erc1155.js';
import { rareErc1155ContractFactoryAbi } from '../contracts/abis/rare-erc1155-contract-factory.js';
import { rareErc1155MarketplaceAbi } from '../contracts/abis/rare-erc1155-marketplace.js';
import { ETH_ADDRESS, contractAddresses, type ContractAddresses, type SupportedChain } from '../contracts/addresses.js';
import { approveNftContractIfNeeded, MinterApprovalRequiredError, runWithApprovalSideEffectAlert } from './approvals-shell.js';
import { toCurrencyAmount, calculateMarketplacePaymentAmountFromSettings, preparePaymentAmountForSpender } from './payments-shell.js';
import type { RareClientConfig } from './types/client.js';
import type {
  DeployErc1155Result,
  Erc1155CollectionNamespace,
  Erc1155CheckoutDecodedFailure,
  Erc1155CheckoutExecution,
  Erc1155CheckoutPayment,
  Erc1155ListingNamespace,
  Erc1155OfferNamespace,
  Erc1155ReleaseNamespace,
} from './types/erc1155.js';
import type { CollectionDeployNamespace } from './types/collection.js';
import type { WalletAccount } from './types/common.js';
import { requireWallet } from './wallet-shell.js';
import { resolveCurrencyForSdk } from './currency.js';
import {
  planErc1155CollectionCreateToken,
  planErc1155CollectionMint,
  planErc1155CollectionMintBatch,
  planErc1155CollectionSetMinterApproval,
  planErc1155CollectionStatus,
  planErc1155CollectionUpdateTokenUri,
  groupErc1155CheckoutPayments,
  erc1155CheckoutFailureStages,
  planErc1155CheckoutInput,
  planErc1155CheckoutResolved,
  planErc1155ListingBuy,
  planErc1155ListingCancel,
  planErc1155ListingCreate,
  planErc1155ListingCreateBatch,
  planErc1155ListingStatus,
  planErc1155OfferAccept,
  planErc1155OfferCancel,
  planErc1155OfferCreate,
  planErc1155ReleaseAllowlistConfig,
  planErc1155ReleaseAllowlistConfigBatch,
  planErc1155ReleaseClearAllowlistConfig,
  planErc1155ReleaseConfigure,
  planErc1155ReleaseConfigureBatch,
  planErc1155ReleaseCancel,
  planErc1155ReleaseLimitConfig,
  planErc1155ReleaseLimitConfigBatch,
  planErc1155ReleaseMint,
  shapeErc1155CollectionStatus,
  shapeErc1155CheckoutResult,
  shapeErc1155CheckoutExecution,
  shapeErc1155ListingStatus,
  shapeErc1155OfferStatus,
  shapeErc1155ReleaseAllowlistConfig,
  shapeErc1155ReleaseLimitConfig,
  shapeErc1155ReleaseStatus,
  totalPrice,
  validateErc1155CheckoutLogs,
  type Erc1155CheckoutProcessedItemInput,
  type Erc1155ListingCreateBatchPlan,
  type Erc1155ListingBuyPlan,
  type Erc1155ListingCreatePlan,
} from './erc1155-core.js';
import {
  buildReleaseAllowlistArtifactFromInput,
  getReleaseAllowlistProof,
  parseReleaseAllowlistArtifactJson,
} from './release-core.js';
import { generateApiAddressMerkleRoot } from './merkle-api.js';

export type * from './types/erc1155.js';

const genericSolidityErrorAbi = [
  {
    inputs: [{ internalType: 'string', name: 'message', type: 'string' }],
    name: 'Error',
    type: 'error',
  },
] as const;

export class Erc1155CheckoutAllItemsSkippedError extends Error {
  readonly execution: Erc1155CheckoutExecution;

  constructor(execution: Erc1155CheckoutExecution) {
    super('ERC-1155 checkout preflight skipped every item; no transaction was submitted.');
    this.name = 'Erc1155CheckoutAllItemsSkippedError';
    this.execution = execution;
  }
}

type Erc1155Addresses = {
  erc20ApprovalManager: Address;
  erc1155Marketplace: Address;
  erc1155ContractFactory: Address;
  erc1155ApprovalManager: Address;
  marketplaceSettings: Address;
}

type Erc1155CheckoutContractItem = {
  itemKind: 0 | 1;
  contractAddress: Address;
  seller: Address;
  currencyAddress: Address;
  tokenId: bigint;
  price: bigint;
  quantity: bigint;
  proof: Hex[];
}

export function createErc1155DeployNamespace(
  publicClient: PublicClient,
  config: RareClientConfig,
  chain: SupportedChain,
  addresses: ContractAddresses,
): Pick<CollectionDeployNamespace, 'erc1155'> {
  return {
    async erc1155(params): ReturnType<CollectionDeployNamespace['erc1155']> {
      const erc1155 = requireErc1155Addresses(chain, addresses);
      const { walletClient, account } = requireWallet(config);
      const txHash = await walletClient.writeContract({
        address: erc1155.erc1155ContractFactory,
        abi: rareErc1155ContractFactoryAbi,
        functionName: 'createRareERC1155Contract',
        args: [params.name, params.symbol, params.baseUri],
        account,
        chain: undefined,
      });
      const receipt = await waitForSuccessfulReceipt(publicClient, txHash, 'erc1155 deploy');
      const logs = parseEventLogs({
        abi: rareErc1155ContractFactoryAbi,
        logs: receipt.logs,
        eventName: 'RareERC1155ContractCreated',
      });
      const log = logs[0];
      if (log === undefined) {
        throw new Error('ERC1155 deploy transaction succeeded but RareERC1155ContractCreated was not found in logs.');
      }

      return {
        txHash,
        receipt,
        contract: log.args.contractAddress,
        factory: erc1155.erc1155ContractFactory,
        defaultMinter: await publicClient.readContract({
          address: erc1155.erc1155ContractFactory,
          abi: rareErc1155ContractFactoryAbi,
          functionName: 'defaultMinter',
        }),
      } satisfies DeployErc1155Result;
    },
  };
}

export function createErc1155CollectionNamespace(
  publicClient: PublicClient,
  config: RareClientConfig,
): Erc1155CollectionNamespace {
  return {
    async createToken(params): ReturnType<Erc1155CollectionNamespace['createToken']> {
      const plan = planErc1155CollectionCreateToken(params);
      const { walletClient, account, accountAddress } = requireWallet(config);
      const royaltyReceiver = plan.royaltyReceiver ?? accountAddress;
      const txHash = await walletClient.writeContract({
        address: plan.contract,
        abi: rareErc1155Abi,
        functionName: 'createToken',
        args: [plan.tokenUri, plan.maxSupply, royaltyReceiver],
        account,
        chain: undefined,
      });
      const receipt = await waitForSuccessfulReceipt(publicClient, txHash, 'erc1155 create token');
      const logs = parseEventLogs({
        abi: rareErc1155Abi,
        logs: receipt.logs,
        eventName: 'TokenCreated',
      });
      const log = logs[0];
      if (log === undefined) {
        throw new Error('ERC1155 create token transaction succeeded but TokenCreated was not found in logs.');
      }

      return {
        txHash,
        receipt,
        contract: plan.contract,
        tokenId: log.args.tokenId,
        maxSupply: plan.maxSupply,
        tokenUri: plan.tokenUri,
        royaltyReceiver,
      };
    },

    async mint(params): ReturnType<Erc1155CollectionNamespace['mint']> {
      const plan = planErc1155CollectionMint(params);
      const { walletClient, account, accountAddress } = requireWallet(config);
      const to = plan.to ?? accountAddress;
      const txHash = await walletClient.writeContract({
        address: plan.contract,
        abi: rareErc1155Abi,
        functionName: 'mintTo',
        args: [to, plan.tokenId, plan.quantity],
        account,
        chain: undefined,
      });
      const receipt = await waitForSuccessfulReceipt(publicClient, txHash, 'erc1155 mint');
      return {
        txHash,
        receipt,
        contract: plan.contract,
        tokenId: plan.tokenId,
        quantity: plan.quantity,
        to,
      };
    },

    async mintBatch(params): ReturnType<Erc1155CollectionNamespace['mintBatch']> {
      const plan = planErc1155CollectionMintBatch(params);
      const { walletClient, account, accountAddress } = requireWallet(config);
      const to = plan.to ?? accountAddress;
      const txHash = await walletClient.writeContract({
        address: plan.contract,
        abi: rareErc1155Abi,
        functionName: 'mintBatchTo',
        args: [to, plan.items.map((item) => item.tokenId), plan.items.map((item) => item.quantity)],
        account,
        chain: undefined,
      });
      const receipt = await waitForSuccessfulReceipt(publicClient, txHash, 'erc1155 batch mint');
      return {
        txHash,
        receipt,
        contract: plan.contract,
        to,
        items: plan.items,
      };
    },

    async setMinterApproval(params): ReturnType<Erc1155CollectionNamespace['setMinterApproval']> {
      const plan = planErc1155CollectionSetMinterApproval(params);
      const { walletClient, account } = requireWallet(config);
      const txHash = await walletClient.writeContract({
        address: plan.contract,
        abi: rareErc1155Abi,
        functionName: 'setMinterApproval',
        args: [plan.minter, plan.approved],
        account,
        chain: undefined,
      });
      const receipt = await waitForSuccessfulReceipt(publicClient, txHash, 'erc1155 set minter approval');
      return {
        txHash,
        receipt,
        contract: plan.contract,
        minter: plan.minter,
        approved: plan.approved,
      };
    },

    async updateTokenUri(params): ReturnType<Erc1155CollectionNamespace['updateTokenUri']> {
      const plan = planErc1155CollectionUpdateTokenUri(params);
      const { walletClient, account } = requireWallet(config);
      await publicClient.simulateContract({
        address: plan.contract,
        abi: rareErc1155Abi,
        functionName: 'updateTokenURI',
        args: [plan.tokenId, plan.tokenUri],
        account,
      });
      const txHash = await walletClient.writeContract({
        address: plan.contract,
        abi: rareErc1155Abi,
        functionName: 'updateTokenURI',
        args: [plan.tokenId, plan.tokenUri],
        account,
        chain: undefined,
      });
      const receipt = await waitForSuccessfulReceipt(publicClient, txHash, 'erc1155 update token URI');
      return {
        txHash,
        receipt,
        contract: plan.contract,
        tokenId: plan.tokenId,
        tokenUri: plan.tokenUri,
      };
    },

    async disable(params): ReturnType<Erc1155CollectionNamespace['disable']> {
      const { walletClient, account } = requireWallet(config);
      await publicClient.simulateContract({
        address: params.contract,
        abi: rareErc1155Abi,
        functionName: 'disableContract',
        args: [],
        account,
      });
      const txHash = await walletClient.writeContract({
        address: params.contract,
        abi: rareErc1155Abi,
        functionName: 'disableContract',
        args: [],
        account,
        chain: undefined,
      });
      const receipt = await waitForSuccessfulReceipt(publicClient, txHash, 'erc1155 disable contract');
      return {
        txHash,
        receipt,
        contract: params.contract,
      };
    },

    async status(params): ReturnType<Erc1155CollectionNamespace['status']> {
      const plan = planErc1155CollectionStatus(params);
      const [
        name,
        symbol,
        owner,
        disabled,
        maxBatchSize,
        approvedMinter,
        uri,
        maxSupply,
        totalMinted,
        balance,
        royalty,
      ] = await Promise.all([
        readOptionalNoArgs(publicClient, plan.contract, 'name'),
        readOptionalNoArgs(publicClient, plan.contract, 'symbol'),
        readOptionalNoArgs(publicClient, plan.contract, 'owner'),
        readOptionalNoArgs(publicClient, plan.contract, 'disabled'),
        readOptionalNoArgs(publicClient, plan.contract, 'MAX_BATCH_SIZE'),
        plan.account === undefined ? Promise.resolve(undefined) : readOptionalAddress(publicClient, plan.contract, 'isApprovedMinter', plan.account),
        plan.tokenId === undefined ? Promise.resolve(undefined) : readOptionalTokenId(publicClient, plan.contract, 'uri', plan.tokenId),
        plan.tokenId === undefined ? Promise.resolve(undefined) : readOptionalTokenId(publicClient, plan.contract, 'maxSupplyForToken', plan.tokenId),
        plan.tokenId === undefined ? Promise.resolve(undefined) : readOptionalTokenId(publicClient, plan.contract, 'totalMintedForToken', plan.tokenId),
        plan.tokenId === undefined || plan.account === undefined
          ? Promise.resolve(undefined)
          : readOptionalBalance(publicClient, plan.contract, plan.account, plan.tokenId),
        plan.tokenId === undefined
          ? Promise.resolve(undefined)
          : readOptionalRoyalty(publicClient, plan.contract, plan.tokenId, 0n),
      ]);

      return shapeErc1155CollectionStatus({
        contract: plan.contract,
        tokenId: plan.tokenId,
        account: plan.account,
        name: typeof name === 'string' ? name : undefined,
        symbol: typeof symbol === 'string' ? symbol : undefined,
        owner: isAddressValue(owner) ? owner : undefined,
        disabled: typeof disabled === 'boolean' ? disabled : undefined,
        maxBatchSize: typeof maxBatchSize === 'bigint' ? maxBatchSize : undefined,
        approvedMinter: typeof approvedMinter === 'boolean' ? approvedMinter : undefined,
        uri: typeof uri === 'string' ? uri : undefined,
        maxSupply: typeof maxSupply === 'bigint' ? maxSupply : undefined,
        totalMinted: typeof totalMinted === 'bigint' ? totalMinted : undefined,
        balance: typeof balance === 'bigint' ? balance : undefined,
        royalty: normalizeAddressBigintTuple(royalty),
      });
    },
  };
}

export function createErc1155ListingNamespace(
  publicClient: PublicClient,
  config: RareClientConfig,
  chain: SupportedChain,
  addresses: ContractAddresses,
): Erc1155ListingNamespace {
  const erc1155 = lazyErc1155Addresses(chain, addresses);
  const release = createErc1155ReleaseNamespace(publicClient, config, chain, erc1155);
  return {
    release,

    async create(params): ReturnType<Erc1155ListingNamespace['create']> {
      const { walletClient, account, accountAddress } = requireWallet(config);
      const currency = params.currency === undefined ? ETH_ADDRESS : resolveCurrencyForSdk(params.currency, chain).address;
      const price = await toCurrencyAmount(publicClient, chain, currency, params.price, 'price');
      const plan = planErc1155ListingCreate({ ...params, currency, price }, accountAddress);
      await preflightErc1155ListingCreate({
        publicClient,
        marketplace: erc1155.erc1155Marketplace,
        approvalManager: erc1155.erc1155ApprovalManager,
        account,
        accountAddress,
        plan,
      });
      const approvalTxHash = await approveNftContractIfNeeded({
        publicClient,
        walletClient,
        account,
        accountAddress,
        nftAddress: plan.contract,
        operator: erc1155.erc1155ApprovalManager,
        autoApprove: params.autoApprove,
      });

      const { txHash, receipt } = await runWithApprovalSideEffectAlert({
        operation: 'erc1155 listing create',
        approvals: [{ type: 'nft', approvalTxHash, target: plan.contract, operator: erc1155.erc1155ApprovalManager }],
        run: async () => {
          const targetTxHash = await walletClient.writeContract({
            address: erc1155.erc1155Marketplace,
            abi: rareErc1155MarketplaceAbi,
            functionName: 'setSalePrices',
            args: [
              plan.contract,
              plan.currency,
              [{
                tokenId: plan.tokenId,
                price: plan.price,
                quantity: plan.quantity,
                expirationTime: plan.expirationTime,
              }],
              plan.splitAddresses,
              plan.splitRatios,
            ],
            account,
            chain: undefined,
          });
          const targetReceipt = await waitForSuccessfulReceipt(publicClient, targetTxHash, 'erc1155 listing create');
          return { txHash: targetTxHash, receipt: targetReceipt };
        },
      });
      return { txHash, receipt, approvalTxHash };
    },

    async createBatch(params): ReturnType<Erc1155ListingNamespace['createBatch']> {
      const { walletClient, account, accountAddress } = requireWallet(config);
      const currency = params.currency === undefined ? ETH_ADDRESS : resolveCurrencyForSdk(params.currency, chain).address;
      const items = await Promise.all(params.items.map(async (item, index) => ({
        ...item,
        price: await toCurrencyAmount(publicClient, chain, currency, item.price, `items[${index}].price`),
      })));
      const plan = planErc1155ListingCreateBatch({ ...params, currency, items }, accountAddress);
      await preflightErc1155ListingCreateBatch({
        publicClient,
        marketplace: erc1155.erc1155Marketplace,
        approvalManager: erc1155.erc1155ApprovalManager,
        account,
        accountAddress,
        plan,
      });
      const approvalTxHash = await approveNftContractIfNeeded({
        publicClient,
        walletClient,
        account,
        accountAddress,
        nftAddress: plan.contract,
        operator: erc1155.erc1155ApprovalManager,
        autoApprove: params.autoApprove,
      });

      const { txHash, receipt } = await runWithApprovalSideEffectAlert({
        operation: 'erc1155 listing create batch',
        approvals: [{ type: 'nft', approvalTxHash, target: plan.contract, operator: erc1155.erc1155ApprovalManager }],
        run: async () => {
          const requests = plan.items.map((item) => ({
            tokenId: item.tokenId,
            price: item.price,
            quantity: item.quantity,
            expirationTime: item.expirationTime,
          }));
          await publicClient.simulateContract({
            address: erc1155.erc1155Marketplace,
            abi: rareErc1155MarketplaceAbi,
            functionName: 'setSalePrices',
            args: [
              plan.contract,
              plan.currency,
              requests,
              plan.splitAddresses,
              plan.splitRatios,
            ],
            account,
          });
          const targetTxHash = await walletClient.writeContract({
            address: erc1155.erc1155Marketplace,
            abi: rareErc1155MarketplaceAbi,
            functionName: 'setSalePrices',
            args: [
              plan.contract,
              plan.currency,
              requests,
              plan.splitAddresses,
              plan.splitRatios,
            ],
            account,
            chain: undefined,
          });
          const targetReceipt = await waitForSuccessfulReceipt(publicClient, targetTxHash, 'erc1155 listing create batch');
          return { txHash: targetTxHash, receipt: targetReceipt };
        },
      });
      return {
        txHash,
        receipt,
        contract: plan.contract,
        currencyAddress: plan.currency,
        items: plan.items,
        splitAddresses: plan.splitAddresses,
        splitRatios: plan.splitRatios,
        approvalTxHash,
      };
    },

    async cancel(params): ReturnType<Erc1155ListingNamespace['cancel']> {
      const { walletClient, account } = requireWallet(config);
      const tokenIds = planErc1155ListingCancel(params);
      const txHash = await walletClient.writeContract({
        address: erc1155.erc1155Marketplace,
        abi: rareErc1155MarketplaceAbi,
        functionName: 'cancelSalePrices',
        args: [params.contract, tokenIds],
        account,
        chain: undefined,
      });
      const receipt = await waitForSuccessfulReceipt(publicClient, txHash, 'erc1155 listing cancel');
      return { txHash, receipt };
    },

    async buy(params): ReturnType<Erc1155ListingNamespace['buy']> {
      const { walletClient, account, accountAddress } = requireWallet(config);
      const currency = params.currency === undefined ? ETH_ADDRESS : resolveCurrencyForSdk(params.currency, chain).address;
      const price = await toCurrencyAmount(publicClient, chain, currency, params.price, 'price');
      const plan = planErc1155ListingBuy({ ...params, currency, price }, accountAddress);
      const requiredAmount = await preflightErc1155ListingBuy({
        publicClient,
        marketplace: erc1155.erc1155Marketplace,
        approvalManager: erc1155.erc1155ApprovalManager,
        marketplaceSettings: erc1155.marketplaceSettings,
        account,
        accountAddress,
        plan,
      });
      const payment = await prepareMarketplacePayment({
        publicClient,
        walletClient,
        account,
        accountAddress,
        addresses: erc1155,
        currency: plan.currency,
        amount: plan.totalPrice,
        autoApprove: params.autoApprove,
      });
      if (payment.requiredAmount !== requiredAmount) {
        throw new Error(
          `ERC1155 listing buy payment changed during preflight. Expected ${requiredAmount.toString()} raw units, ` +
            `read ${payment.requiredAmount.toString()} raw units.`,
        );
      }
      const { txHash, receipt } = await runWithApprovalSideEffectAlert({
        operation: 'erc1155 listing buy',
        approvals: [{
          type: 'erc20',
          approvalTxHash: payment.approvalTxHash,
          target: plan.currency,
          spender: erc1155.erc20ApprovalManager,
        }],
        run: async () => {
          const targetTxHash = await walletClient.writeContract({
            address: erc1155.erc1155Marketplace,
            abi: rareErc1155MarketplaceAbi,
            functionName: 'buyBatch',
            args: [plan.contract, plan.seller, plan.currency, plan.recipient, [{ tokenId: plan.tokenId, price: plan.price, quantity: plan.quantity }]],
            account,
            chain: undefined,
            value: payment.value,
          });
          const targetReceipt = await waitForSuccessfulReceipt(publicClient, targetTxHash, 'erc1155 listing buy');
          return { txHash: targetTxHash, receipt: targetReceipt };
        },
      });
      return { txHash, receipt, buyer: accountAddress, recipient: plan.recipient, approvalTxHash: payment.approvalTxHash };
    },

    async checkout(params): ReturnType<Erc1155ListingNamespace['checkout']> {
      const { walletClient, account, accountAddress } = requireWallet(config);
      const inputPlan = planErc1155CheckoutInput(params);
      const resolvedItems = await Promise.all(inputPlan.map(async (item, index) => {
        if (item.kind === 'listing') {
          const currency = item.currencyInput === undefined ? ETH_ADDRESS : resolveCurrencyForSdk(item.currencyInput, chain).address;
          const price = await toCurrencyAmount(publicClient, chain, currency, item.priceInput, `items[${index}].price`);
          return {
            kind: item.kind,
            contract: item.contract,
            seller: item.seller,
            currency,
            tokenId: item.tokenId,
            price,
            quantity: item.quantity,
            proof: item.proof,
          };
        }

        const explicitCurrency = item.currencyInput === undefined ? undefined : resolveCurrencyForSdk(item.currencyInput, chain).address;
        const priceCurrency = explicitCurrency ?? ETH_ADDRESS;
        const explicitPrice = item.priceInput === undefined
          ? undefined
          : await toCurrencyAmount(publicClient, chain, priceCurrency, item.priceInput, `items[${index}].price`);
        const configRead = await publicClient.readContract({
          address: erc1155.erc1155Marketplace,
          abi: rareErc1155MarketplaceAbi,
          functionName: 'getDirectSaleConfig',
          args: [item.contract, item.tokenId],
        });
        const directSale = normalizeDirectSaleConfig(configRead);
        return {
          kind: item.kind,
          contract: item.contract,
          seller: directSale[0],
          currency: explicitCurrency ?? directSale[1],
          tokenId: item.tokenId,
          price: explicitPrice ?? directSale[2],
          quantity: item.quantity,
          proof: item.proof,
        };
      }));
      const checkout = planErc1155CheckoutResolved({ recipient: params.recipient ?? accountAddress, items: resolvedItems });
      const checkoutContractItems: Erc1155CheckoutContractItem[] = checkout.items.map((item) => ({
        itemKind: item.itemKind,
        contractAddress: item.contract,
        seller: item.seller,
        currencyAddress: item.currency,
        tokenId: item.tokenId,
        price: item.price,
        quantity: item.quantity,
        proof: item.proof,
      }));
      const paymentRequirements = await Promise.all(checkout.items.map(async (item) => ({
        currencyAddress: item.currency,
        requiredAmount: await calculateMarketplacePaymentAmountFromSettings(
          publicClient,
          erc1155.marketplaceSettings,
          item.totalPrice,
        ),
      })));
      const groupedRequirements = groupErc1155CheckoutPayments(paymentRequirements);
      const value = groupedRequirements
        .filter((requirement) => isAddressEqual(requirement.currencyAddress, ETH_ADDRESS))
        .reduce((sum, requirement) => sum + requirement.requiredAmount, 0n);
      const firstPreflight = await simulateErc1155Checkout({
        publicClient,
        marketplace: erc1155.erc1155Marketplace,
        account,
        recipient: checkout.recipient,
        items: checkoutContractItems,
        value,
      });
      assertCheckoutPreflightCanSubmit(firstPreflight);
      const payments = await Promise.all(groupedRequirements.map(async (requirement): Promise<Erc1155CheckoutPayment> => {
        const payment = await preparePaymentAmountForSpender({
          publicClient,
          walletClient,
          account,
          accountAddress,
          spenderAddress: erc1155.erc20ApprovalManager,
          currency: requirement.currencyAddress,
          requiredAmount: requirement.requiredAmount,
          autoApprove: params.autoApprove,
        });
        return {
          currencyAddress: requirement.currencyAddress,
          requiredAmount: payment.requiredAmount,
          approvalTxHash: payment.approvalTxHash,
        };
      }));
      const { txHash, receipt } = await runWithApprovalSideEffectAlert({
        operation: 'erc1155 checkout',
        approvals: payments.map((payment) => ({
          type: 'erc20',
          approvalTxHash: payment.approvalTxHash,
          target: payment.currencyAddress,
          spender: erc1155.erc20ApprovalManager,
        })),
        run: async () => {
          const finalPreflight = await simulateErc1155Checkout({
            publicClient,
            marketplace: erc1155.erc1155Marketplace,
            account,
            recipient: checkout.recipient,
            items: checkoutContractItems,
            value,
          });
          assertCheckoutPreflightCanSubmit(finalPreflight, { allowApprovalFixable: false });
          const targetTxHash = await walletClient.writeContract({
            address: erc1155.erc1155Marketplace,
            abi: rareErc1155MarketplaceAbi,
            functionName: 'checkout',
            args: [checkout.recipient, checkoutContractItems],
            account,
            chain: undefined,
            value,
          });
          const targetReceipt = await waitForSuccessfulReceipt(publicClient, targetTxHash, 'erc1155 checkout');
          return { txHash: targetTxHash, receipt: targetReceipt };
        },
      });
      const processed = parseEventLogs({
        abi: rareErc1155MarketplaceAbi,
        logs: receipt.logs,
        eventName: 'CheckoutItemProcessed',
      }).map((log): Erc1155CheckoutProcessedItemInput => ({
        itemIndex: log.args.itemIndex,
        itemKind: Number(log.args.itemKind),
        contractAddress: log.args.contractAddress,
        tokenId: log.args.tokenId,
        seller: log.args.seller,
        currencyAddress: log.args.currencyAddress,
        price: log.args.price,
        quantity: log.args.quantity,
        filled: log.args.filled,
        failureStage: Number(log.args.failureStage),
        reason: log.args.reason,
        failureData: log.args.failureData,
        totalPaid: log.args.totalPaid,
        decodedFailure: log.args.filled ? undefined : decodeCheckoutFailure(log.args.failureData),
      }));
      const completedLogs = parseEventLogs({
        abi: rareErc1155MarketplaceAbi,
        logs: receipt.logs,
        eventName: 'CheckoutCompleted',
      }).map((log) => ({
        payer: log.args.payer,
        recipient: log.args.recipient,
        filledCount: log.args.filledCount,
        skippedCount: log.args.skippedCount,
        ethSpent: log.args.ethSpent,
        ethRefunded: log.args.ethRefunded,
      }));
      const validatedCheckout = validateErc1155CheckoutLogs({
        txHash,
        expectedItems: checkoutContractItems,
        completedLogs,
        processedItems: processed,
        ethValue: value,
      });
      return shapeErc1155CheckoutResult({
        marketplace: erc1155.erc1155Marketplace,
        txHash,
        receipt,
        completed: validatedCheckout.completed,
        items: validatedCheckout.items,
        payments,
      });
    },

    async status(params): ReturnType<Erc1155ListingNamespace['status']> {
      const plan = planErc1155ListingStatus(params);
      const raw = await publicClient.readContract({
        address: erc1155.erc1155Marketplace,
        abi: rareErc1155MarketplaceAbi,
        functionName: 'getSalePrice',
        args: [plan.contract, plan.tokenId, plan.seller],
      });
      const wallet = config.account ?? config.walletClient?.account?.address ?? null;
      return shapeErc1155ListingStatus(normalizeSalePrice(raw), {
        seller: plan.seller,
        wallet,
        nowSeconds: nowSeconds(),
      });
    },
  };
}

export function createErc1155OfferNamespace(
  publicClient: PublicClient,
  config: RareClientConfig,
  chain: SupportedChain,
  addresses: ContractAddresses,
): Erc1155OfferNamespace {
  const erc1155 = lazyErc1155Addresses(chain, addresses);
  return {
    async create(params): ReturnType<Erc1155OfferNamespace['create']> {
      const { walletClient, account, accountAddress } = requireWallet(config);
      const currency = params.currency === undefined ? ETH_ADDRESS : resolveCurrencyForSdk(params.currency, chain).address;
      const price = await toCurrencyAmount(publicClient, chain, currency, params.price, 'price');
      const plan = planErc1155OfferCreate({ ...params, currency, price });
      const payment = await prepareMarketplacePayment({
        publicClient,
        walletClient,
        account,
        accountAddress,
        addresses: erc1155,
        currency: plan.currency,
        amount: plan.totalPrice,
        autoApprove: params.autoApprove,
      });
      const { txHash, receipt } = await runWithApprovalSideEffectAlert({
        operation: 'erc1155 offer create',
        approvals: [{
          type: 'erc20',
          approvalTxHash: payment.approvalTxHash,
          target: plan.currency,
          spender: erc1155.erc20ApprovalManager,
        }],
        run: async () => {
          const targetTxHash = await walletClient.writeContract({
            address: erc1155.erc1155Marketplace,
            abi: rareErc1155MarketplaceAbi,
            functionName: 'makeOffer',
            args: [plan.contract, plan.tokenId, plan.currency, plan.price, plan.quantity, plan.expirationTime],
            account,
            chain: undefined,
            value: payment.value,
          });
          const targetReceipt = await waitForSuccessfulReceipt(publicClient, targetTxHash, 'erc1155 offer create');
          return { txHash: targetTxHash, receipt: targetReceipt };
        },
      });
      return { txHash, receipt, approvalTxHash: payment.approvalTxHash };
    },

    async cancel(params): ReturnType<Erc1155OfferNamespace['cancel']> {
      const { walletClient, account } = requireWallet(config);
      const currency = params.currency === undefined ? ETH_ADDRESS : resolveCurrencyForSdk(params.currency, chain).address;
      const plan = planErc1155OfferCancel({ ...params, currency });
      const txHash = await walletClient.writeContract({
        address: erc1155.erc1155Marketplace,
        abi: rareErc1155MarketplaceAbi,
        functionName: 'cancelOffer',
        args: [params.contract, plan.tokenId, plan.currency],
        account,
        chain: undefined,
      });
      const receipt = await waitForSuccessfulReceipt(publicClient, txHash, 'erc1155 offer cancel');
      return { txHash, receipt };
    },

    async accept(params): ReturnType<Erc1155OfferNamespace['accept']> {
      const { walletClient, account, accountAddress } = requireWallet(config);
      const currency = params.currency === undefined ? ETH_ADDRESS : resolveCurrencyForSdk(params.currency, chain).address;
      const price = await toCurrencyAmount(publicClient, chain, currency, params.price, 'price');
      const plan = planErc1155OfferAccept({ ...params, currency, price }, accountAddress);
      const approvalTxHash = await approveNftContractIfNeeded({
        publicClient,
        walletClient,
        account,
        accountAddress,
        nftAddress: plan.contract,
        operator: erc1155.erc1155ApprovalManager,
        autoApprove: params.autoApprove,
      });
      const { txHash, receipt } = await runWithApprovalSideEffectAlert({
        operation: 'erc1155 offer accept',
        approvals: [{ type: 'nft', approvalTxHash, target: plan.contract, operator: erc1155.erc1155ApprovalManager }],
        run: async () => {
          const targetTxHash = await walletClient.writeContract({
            address: erc1155.erc1155Marketplace,
            abi: rareErc1155MarketplaceAbi,
            functionName: 'acceptOffer',
            args: [
              plan.contract,
              plan.tokenId,
              plan.buyer,
              plan.currency,
              plan.price,
              plan.quantity,
              plan.splitAddresses,
              plan.splitRatios,
            ],
            account,
            chain: undefined,
          });
          const targetReceipt = await waitForSuccessfulReceipt(publicClient, targetTxHash, 'erc1155 offer accept');
          return { txHash: targetTxHash, receipt: targetReceipt };
        },
      });
      return { txHash, receipt, approvalTxHash };
    },

    async status(params): ReturnType<Erc1155OfferNamespace['status']> {
      const currency = params.currency === undefined ? ETH_ADDRESS : resolveCurrencyForSdk(params.currency, chain).address;
      const buyer = params.buyer ?? config.account ?? config.walletClient?.account?.address;
      if (buyer === undefined) {
        throw new Error('ERC1155 offer status requires buyer or a configured wallet/account.');
      }
      const plan = planErc1155OfferCancel({ tokenId: params.tokenId, currency });
      const raw = await publicClient.readContract({
        address: erc1155.erc1155Marketplace,
        abi: rareErc1155MarketplaceAbi,
        functionName: 'getOffer',
        args: [params.contract, plan.tokenId, buyer, plan.currency],
      });
      const wallet = config.account ?? config.walletClient?.account?.address ?? null;
      return shapeErc1155OfferStatus(normalizeOffer(raw), {
        buyer,
        wallet,
        nowSeconds: nowSeconds(),
      });
    },
  };
}

function createErc1155ReleaseNamespace(
  publicClient: PublicClient,
  config: RareClientConfig,
  chain: SupportedChain,
  addresses: Erc1155Addresses,
): Erc1155ReleaseNamespace {
  const release: Erc1155ReleaseNamespace = {
    allowlist: {
      build(params) {
        return buildReleaseAllowlistArtifactFromInput(params.input, params.format);
      },
      parse(params) {
        return parseReleaseAllowlistArtifactJson(params.input);
      },
      proof(params) {
        return getReleaseAllowlistProof(params);
      },
      async getConfig(params) {
        const tokenId = planErc1155ListingStatus({ contract: params.contract, tokenId: params.tokenId, seller: zeroAddress }).tokenId;
        const raw = await publicClient.readContract({
          address: addresses.erc1155Marketplace,
          abi: rareErc1155MarketplaceAbi,
          functionName: 'getTokenAllowListConfig',
          args: [params.contract, tokenId],
        });
        return shapeErc1155ReleaseAllowlistConfig(normalizeAllowlist(raw), {
          marketplace: addresses.erc1155Marketplace,
          contract: params.contract,
          tokenId,
          nowSeconds: nowSeconds(),
        });
      },
      async setConfig(params) {
        const plan = planErc1155ReleaseAllowlistConfig(params);
        await uploadErc1155ReleaseAllowlistArtifact(config, params, plan.root);
        const { walletClient, account } = requireWallet(config);
        const txHash = await walletClient.writeContract({
          address: addresses.erc1155Marketplace,
          abi: rareErc1155MarketplaceAbi,
          functionName: 'setTokenAllowListConfigs',
          args: [plan.contract, [{ tokenId: plan.tokenId, root: plan.root, endTimestamp: plan.endTimestamp }]],
          account,
          chain: undefined,
        });
        const receipt = await waitForSuccessfulReceipt(publicClient, txHash, 'erc1155 release allowlist set');
        return {
          txHash,
          receipt,
          config: shapeErc1155ReleaseAllowlistConfig([plan.root, plan.endTimestamp], {
            marketplace: addresses.erc1155Marketplace,
            contract: plan.contract,
            tokenId: plan.tokenId,
            nowSeconds: nowSeconds(),
          }),
        };
      },
      async setConfigBatch(params) {
        const plans = planErc1155ReleaseAllowlistConfigBatch(params);
        const { walletClient, account } = requireWallet(config);
        const requests = plans.map((plan) => ({ tokenId: plan.tokenId, root: plan.root, endTimestamp: plan.endTimestamp }));
        await publicClient.simulateContract({
          address: addresses.erc1155Marketplace,
          abi: rareErc1155MarketplaceAbi,
          functionName: 'setTokenAllowListConfigs',
          args: [params.contract, requests],
          account,
        });
        const txHash = await walletClient.writeContract({
          address: addresses.erc1155Marketplace,
          abi: rareErc1155MarketplaceAbi,
          functionName: 'setTokenAllowListConfigs',
          args: [params.contract, requests],
          account,
          chain: undefined,
        });
        const receipt = await waitForSuccessfulReceipt(publicClient, txHash, 'erc1155 release allowlist set batch');
        const now = nowSeconds();
        return {
          txHash,
          receipt,
          configs: plans.map((plan) => shapeErc1155ReleaseAllowlistConfig([plan.root, plan.endTimestamp], {
            marketplace: addresses.erc1155Marketplace,
            contract: plan.contract,
            tokenId: plan.tokenId,
            nowSeconds: now,
          })),
        };
      },
      async clear(params) {
        const plan = planErc1155ReleaseClearAllowlistConfig(params);
        const { walletClient, account } = requireWallet(config);
        const txHash = await walletClient.writeContract({
          address: addresses.erc1155Marketplace,
          abi: rareErc1155MarketplaceAbi,
          functionName: 'setTokenAllowListConfigs',
          args: [plan.contract, [{ tokenId: plan.tokenId, root: plan.root, endTimestamp: plan.endTimestamp }]],
          account,
          chain: undefined,
        });
        const receipt = await waitForSuccessfulReceipt(publicClient, txHash, 'erc1155 release allowlist clear');
        return {
          txHash,
          receipt,
          config: shapeErc1155ReleaseAllowlistConfig([plan.root, plan.endTimestamp], {
            marketplace: addresses.erc1155Marketplace,
            contract: plan.contract,
            tokenId: plan.tokenId,
            nowSeconds: nowSeconds(),
          }),
        };
      },
    },
    limits: {
      async getMint(params) {
        const tokenId = planErc1155ListingStatus({ contract: params.contract, tokenId: params.tokenId, seller: zeroAddress }).tokenId;
        const limit = await publicClient.readContract({
          address: addresses.erc1155Marketplace,
          abi: rareErc1155MarketplaceAbi,
          functionName: 'getTokenMintLimit',
          args: [params.contract, tokenId],
        });
        return shapeErc1155ReleaseLimitConfig(limit, { marketplace: addresses.erc1155Marketplace, contract: params.contract, tokenId });
      },
      async setMint(params) {
        const plan = planErc1155ReleaseLimitConfig(params);
        const { walletClient, account } = requireWallet(config);
        const txHash = await walletClient.writeContract({
          address: addresses.erc1155Marketplace,
          abi: rareErc1155MarketplaceAbi,
          functionName: 'setTokenMintLimits',
          args: [plan.contract, [{ tokenId: plan.tokenId, limit: plan.limit }]],
          account,
          chain: undefined,
        });
        const receipt = await waitForSuccessfulReceipt(publicClient, txHash, 'erc1155 release mint limit set');
        return {
          txHash,
          receipt,
          config: shapeErc1155ReleaseLimitConfig(plan.limit, { marketplace: addresses.erc1155Marketplace, contract: plan.contract, tokenId: plan.tokenId }),
        };
      },
      async setMintBatch(params) {
        const plans = planErc1155ReleaseLimitConfigBatch(params);
        const { walletClient, account } = requireWallet(config);
        const requests = plans.map((plan) => ({ tokenId: plan.tokenId, limit: plan.limit }));
        await publicClient.simulateContract({
          address: addresses.erc1155Marketplace,
          abi: rareErc1155MarketplaceAbi,
          functionName: 'setTokenMintLimits',
          args: [params.contract, requests],
          account,
        });
        const txHash = await walletClient.writeContract({
          address: addresses.erc1155Marketplace,
          abi: rareErc1155MarketplaceAbi,
          functionName: 'setTokenMintLimits',
          args: [params.contract, requests],
          account,
          chain: undefined,
        });
        const receipt = await waitForSuccessfulReceipt(publicClient, txHash, 'erc1155 release mint limit set batch');
        return {
          txHash,
          receipt,
          configs: plans.map((plan) => shapeErc1155ReleaseLimitConfig(
            plan.limit,
            { marketplace: addresses.erc1155Marketplace, contract: plan.contract, tokenId: plan.tokenId },
          )),
        };
      },
      async getTx(params) {
        const tokenId = planErc1155ListingStatus({ contract: params.contract, tokenId: params.tokenId, seller: zeroAddress }).tokenId;
        const limit = await publicClient.readContract({
          address: addresses.erc1155Marketplace,
          abi: rareErc1155MarketplaceAbi,
          functionName: 'getTokenTxLimit',
          args: [params.contract, tokenId],
        });
        return shapeErc1155ReleaseLimitConfig(limit, { marketplace: addresses.erc1155Marketplace, contract: params.contract, tokenId });
      },
      async setTx(params) {
        const plan = planErc1155ReleaseLimitConfig(params);
        const { walletClient, account } = requireWallet(config);
        const txHash = await walletClient.writeContract({
          address: addresses.erc1155Marketplace,
          abi: rareErc1155MarketplaceAbi,
          functionName: 'setTokenTxLimits',
          args: [plan.contract, [{ tokenId: plan.tokenId, limit: plan.limit }]],
          account,
          chain: undefined,
        });
        const receipt = await waitForSuccessfulReceipt(publicClient, txHash, 'erc1155 release transaction limit set');
        return {
          txHash,
          receipt,
          config: shapeErc1155ReleaseLimitConfig(plan.limit, { marketplace: addresses.erc1155Marketplace, contract: plan.contract, tokenId: plan.tokenId }),
        };
      },
      async setTxBatch(params) {
        const plans = planErc1155ReleaseLimitConfigBatch(params);
        const { walletClient, account } = requireWallet(config);
        const requests = plans.map((plan) => ({ tokenId: plan.tokenId, limit: plan.limit }));
        await publicClient.simulateContract({
          address: addresses.erc1155Marketplace,
          abi: rareErc1155MarketplaceAbi,
          functionName: 'setTokenTxLimits',
          args: [params.contract, requests],
          account,
        });
        const txHash = await walletClient.writeContract({
          address: addresses.erc1155Marketplace,
          abi: rareErc1155MarketplaceAbi,
          functionName: 'setTokenTxLimits',
          args: [params.contract, requests],
          account,
          chain: undefined,
        });
        const receipt = await waitForSuccessfulReceipt(publicClient, txHash, 'erc1155 release transaction limit set batch');
        return {
          txHash,
          receipt,
          configs: plans.map((plan) => shapeErc1155ReleaseLimitConfig(
            plan.limit,
            { marketplace: addresses.erc1155Marketplace, contract: plan.contract, tokenId: plan.tokenId },
          )),
        };
      },
    },

    async configure(params) {
      const { walletClient, account, accountAddress } = requireWallet(config);
      const currency = params.currency === undefined ? ETH_ADDRESS : resolveCurrencyForSdk(params.currency, chain).address;
      const price = await toCurrencyAmount(publicClient, chain, currency, params.price, 'price');
      const plan = planErc1155ReleaseConfigure({ ...params, currency, price }, accountAddress, nowSeconds());
      const approvalTxHash = await approveMinterIfNeeded({
        publicClient,
        walletClient,
        account,
        contract: plan.contract,
        minter: addresses.erc1155Marketplace,
        autoApprove: params.autoApprove,
      });
      const { txHash, receipt } = await runWithApprovalSideEffectAlert({
        operation: 'erc1155 release configure',
        approvals: [{ type: 'minter', approvalTxHash, target: plan.contract, minter: addresses.erc1155Marketplace }],
        run: async () => {
          const targetTxHash = await walletClient.writeContract({
            address: addresses.erc1155Marketplace,
            abi: rareErc1155MarketplaceAbi,
            functionName: 'prepareMintDirectSales',
            args: [
              plan.contract,
              plan.currency,
              [{ tokenId: plan.tokenId, price: plan.price, startTime: plan.startTime, maxMints: plan.maxMints }],
              plan.splitAddresses,
              plan.splitRatios,
            ],
            account,
            chain: undefined,
          });
          const targetReceipt = await waitForSuccessfulReceipt(publicClient, targetTxHash, 'erc1155 release configure');
          return { txHash: targetTxHash, receipt: targetReceipt };
        },
      });
      return {
        txHash,
        receipt,
        marketplace: addresses.erc1155Marketplace,
        contract: plan.contract,
        tokenId: plan.tokenId,
        currencyAddress: plan.currency,
        price: plan.price,
        startTime: plan.startTime,
        maxMints: plan.maxMints,
        splitRecipients: plan.splitAddresses,
        splitRatios: plan.splitRatios,
        approvalTxHash,
      };
    },

    async configureBatch(params) {
      const { walletClient, account, accountAddress } = requireWallet(config);
      const currency = params.currency === undefined ? ETH_ADDRESS : resolveCurrencyForSdk(params.currency, chain).address;
      const items = await Promise.all(params.items.map(async (item, index) => ({
        ...item,
        price: await toCurrencyAmount(publicClient, chain, currency, item.price, `items[${index}].price`),
      })));
      const plan = planErc1155ReleaseConfigureBatch({ ...params, currency, items }, accountAddress, nowSeconds());
      const approvalTxHash = await approveMinterIfNeeded({
        publicClient,
        walletClient,
        account,
        contract: plan.contract,
        minter: addresses.erc1155Marketplace,
        autoApprove: params.autoApprove,
      });
      const { txHash, receipt } = await runWithApprovalSideEffectAlert({
        operation: 'erc1155 release configure batch',
        approvals: [{ type: 'minter', approvalTxHash, target: plan.contract, minter: addresses.erc1155Marketplace }],
        run: async () => {
          const requests = plan.items.map((item) => ({
            tokenId: item.tokenId,
            price: item.price,
            startTime: item.startTime,
            maxMints: item.maxMints,
          }));
          await publicClient.simulateContract({
            address: addresses.erc1155Marketplace,
            abi: rareErc1155MarketplaceAbi,
            functionName: 'prepareMintDirectSales',
            args: [
              plan.contract,
              plan.currency,
              requests,
              plan.splitAddresses,
              plan.splitRatios,
            ],
            account,
          });
          const targetTxHash = await walletClient.writeContract({
            address: addresses.erc1155Marketplace,
            abi: rareErc1155MarketplaceAbi,
            functionName: 'prepareMintDirectSales',
            args: [
              plan.contract,
              plan.currency,
              requests,
              plan.splitAddresses,
              plan.splitRatios,
            ],
            account,
            chain: undefined,
          });
          const targetReceipt = await waitForSuccessfulReceipt(publicClient, targetTxHash, 'erc1155 release configure batch');
          return { txHash: targetTxHash, receipt: targetReceipt };
        },
      });
      return {
        txHash,
        receipt,
        marketplace: addresses.erc1155Marketplace,
        contract: plan.contract,
        currencyAddress: plan.currency,
        items: plan.items,
        splitRecipients: plan.splitAddresses,
        splitRatios: plan.splitRatios,
        approvalTxHash,
      };
    },

    async cancel(params) {
      const plan = planErc1155ReleaseCancel(params);
      const { walletClient, account } = requireWallet(config);
      await publicClient.simulateContract({
        address: addresses.erc1155Marketplace,
        abi: rareErc1155MarketplaceAbi,
        functionName: 'cancelMintDirectSales',
        args: [plan.contract, plan.tokenIds],
        account,
      });
      const txHash = await walletClient.writeContract({
        address: addresses.erc1155Marketplace,
        abi: rareErc1155MarketplaceAbi,
        functionName: 'cancelMintDirectSales',
        args: [plan.contract, plan.tokenIds],
        account,
        chain: undefined,
      });
      const receipt = await waitForSuccessfulReceipt(publicClient, txHash, 'erc1155 release cancel');
      return {
        txHash,
        receipt,
        marketplace: addresses.erc1155Marketplace,
        contract: plan.contract,
        tokenIds: plan.tokenIds,
      };
    },

    async mint(params) {
      const { walletClient, account, accountAddress } = requireWallet(config);
      const plan = planErc1155ReleaseMint({
        ...params,
        currency: params.currency === undefined ? undefined : resolveCurrencyForSdk(params.currency, chain).address,
        price: params.price === undefined
          ? undefined
          : await toCurrencyAmount(
            publicClient,
            chain,
            params.currency === undefined ? ETH_ADDRESS : resolveCurrencyForSdk(params.currency, chain).address,
            params.price,
            'price',
          ),
      }, accountAddress);
      const configRead = await publicClient.readContract({
        address: addresses.erc1155Marketplace,
        abi: rareErc1155MarketplaceAbi,
        functionName: 'getDirectSaleConfig',
        args: [plan.contract, plan.tokenId],
      });
      const directSale = normalizeDirectSaleConfig(configRead);
      const currency = plan.currency ?? directSale[1];
      const price = plan.price ?? directSale[2];
      const amount = totalPrice(price, plan.quantity);
      const payment = await prepareMarketplacePayment({
        publicClient,
        walletClient,
        account,
        accountAddress,
        addresses,
        currency,
        amount,
        autoApprove: params.autoApprove,
      });
      const { txHash, receipt } = await runWithApprovalSideEffectAlert({
        operation: 'erc1155 release mint',
        approvals: [{ type: 'erc20', approvalTxHash: payment.approvalTxHash, target: currency, spender: addresses.erc20ApprovalManager }],
        run: async () => {
          const targetTxHash = await walletClient.writeContract({
            address: addresses.erc1155Marketplace,
            abi: rareErc1155MarketplaceAbi,
            functionName: 'mintDirectSaleBatch',
            args: [plan.contract, currency, plan.recipient, [{ tokenId: plan.tokenId, price, quantity: plan.quantity, proof: plan.proof }]],
            account,
            chain: undefined,
            value: payment.value,
          });
          const targetReceipt = await waitForSuccessfulReceipt(publicClient, targetTxHash, 'erc1155 release mint');
          return { txHash: targetTxHash, receipt: targetReceipt };
        },
      });
      return {
        txHash,
        receipt,
        marketplace: addresses.erc1155Marketplace,
        contract: plan.contract,
        tokenId: plan.tokenId,
        buyer: accountAddress,
        recipient: plan.recipient,
        seller: directSale[0],
        quantity: plan.quantity,
        currencyAddress: currency,
        price,
        totalPrice: amount,
        requiredPayment: payment.requiredAmount,
        approvalTxHash: payment.approvalTxHash,
        allowlistRequired: plan.proof.length > 0,
      };
    },

    async status(params) {
      const tokenId = planErc1155ListingStatus({ contract: params.contract, tokenId: params.tokenId, seller: zeroAddress }).tokenId;
      const account = params.account ?? config.account ?? config.walletClient?.account?.address ?? null;
      const [
        configRead,
        allowlist,
        mintLimit,
        txLimit,
        accountMints,
        accountTxs,
        maxSupply,
        totalMinted,
      ] = await Promise.all([
        publicClient.readContract({
          address: addresses.erc1155Marketplace,
          abi: rareErc1155MarketplaceAbi,
          functionName: 'getDirectSaleConfig',
          args: [params.contract, tokenId],
        }),
        publicClient.readContract({
          address: addresses.erc1155Marketplace,
          abi: rareErc1155MarketplaceAbi,
          functionName: 'getTokenAllowListConfig',
          args: [params.contract, tokenId],
        }),
        publicClient.readContract({
          address: addresses.erc1155Marketplace,
          abi: rareErc1155MarketplaceAbi,
          functionName: 'getTokenMintLimit',
          args: [params.contract, tokenId],
        }),
        publicClient.readContract({
          address: addresses.erc1155Marketplace,
          abi: rareErc1155MarketplaceAbi,
          functionName: 'getTokenTxLimit',
          args: [params.contract, tokenId],
        }),
        account === null
          ? Promise.resolve(null)
          : publicClient.readContract({
            address: addresses.erc1155Marketplace,
            abi: rareErc1155MarketplaceAbi,
            functionName: 'getTokenMintsPerAddress',
            args: [params.contract, tokenId, account],
          }),
        account === null
          ? Promise.resolve(null)
          : publicClient.readContract({
            address: addresses.erc1155Marketplace,
            abi: rareErc1155MarketplaceAbi,
            functionName: 'getTokenTxsPerAddress',
            args: [params.contract, tokenId, account],
          }),
        readOptionalTokenId(publicClient, params.contract, 'maxSupplyForToken', tokenId),
        readOptionalTokenId(publicClient, params.contract, 'totalMintedForToken', tokenId),
      ]);
      return shapeErc1155ReleaseStatus({
        marketplace: addresses.erc1155Marketplace,
        contract: params.contract,
        tokenId,
        config: normalizeDirectSaleConfig(configRead),
        allowlist: normalizeAllowlist(allowlist),
        mintLimit,
        txLimit,
        account,
        accountMints,
        accountTxs,
        maxSupply: typeof maxSupply === 'bigint' ? maxSupply : null,
        totalMinted: typeof totalMinted === 'bigint' ? totalMinted : null,
        nowSeconds: nowSeconds(),
      });
    },
  };
  return release;
}

async function uploadErc1155ReleaseAllowlistArtifact(
  config: RareClientConfig,
  params: Parameters<Erc1155ReleaseNamespace['allowlist']['setConfig']>[0],
  expectedRoot: Hex,
): Promise<void> {
  if (params.root !== undefined || params.artifact === undefined) {
    return;
  }

  const root = await generateApiAddressMerkleRoot(config, {
    addresses: params.artifact.wallets.map((wallet) => wallet.address),
    storageTarget: 'collection-allowlist',
  });

  if (hexToBigInt(root) !== hexToBigInt(expectedRoot)) {
    throw new Error(`rare-api allowlist root ${root} does not match artifact root ${expectedRoot}.`);
  }
}

function requireErc1155Addresses(chain: SupportedChain, addresses: ContractAddresses): Erc1155Addresses {
  if (!addresses.erc20ApprovalManager || !addresses.erc1155Marketplace || !addresses.erc1155ContractFactory || !addresses.erc1155ApprovalManager || !addresses.marketplaceSettings) {
    const deployed = Object.entries(contractAddresses)
      .filter(([, set]) => (
        set.erc20ApprovalManager !== undefined &&
        set.erc1155Marketplace !== undefined &&
        set.erc1155ContractFactory !== undefined &&
        set.erc1155ApprovalManager !== undefined &&
        set.marketplaceSettings !== undefined
      ))
      .map(([name]) => name);
    throw new Error(`ERC1155 contracts are not configured for "${chain}". Supported chains: ${deployed.join(', ')}`);
  }
  return {
    erc20ApprovalManager: addresses.erc20ApprovalManager,
    erc1155Marketplace: addresses.erc1155Marketplace,
    erc1155ContractFactory: addresses.erc1155ContractFactory,
    erc1155ApprovalManager: addresses.erc1155ApprovalManager,
    marketplaceSettings: addresses.marketplaceSettings,
  };
}

function lazyErc1155Addresses(chain: SupportedChain, addresses: ContractAddresses): Erc1155Addresses {
  return {
    get erc20ApprovalManager(): Address {
      return requireErc1155Addresses(chain, addresses).erc20ApprovalManager;
    },
    get erc1155Marketplace(): Address {
      return requireErc1155Addresses(chain, addresses).erc1155Marketplace;
    },
    get erc1155ContractFactory(): Address {
      return requireErc1155Addresses(chain, addresses).erc1155ContractFactory;
    },
    get erc1155ApprovalManager(): Address {
      return requireErc1155Addresses(chain, addresses).erc1155ApprovalManager;
    },
    get marketplaceSettings(): Address {
      return requireErc1155Addresses(chain, addresses).marketplaceSettings;
    },
  };
}

async function waitForSuccessfulReceipt(
  publicClient: PublicClient,
  hash: Hash,
  operation: string,
): Promise<TransactionReceipt> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`${operation} transaction ${hash} was mined with status "${receipt.status}".`);
  }
  return receipt;
}

async function preflightErc1155ListingCreate(opts: {
  publicClient: PublicClient;
  marketplace: Address;
  approvalManager: Address;
  account: Address | WalletAccount;
  accountAddress: Address;
  plan: Erc1155ListingCreatePlan;
}): Promise<void> {
  const [balance, approved] = await Promise.all([
    opts.publicClient.readContract({
      address: opts.plan.contract,
      abi: rareErc1155Abi,
      functionName: 'balanceOf',
      args: [opts.accountAddress, opts.plan.tokenId],
    }),
    opts.publicClient.readContract({
      address: opts.plan.contract,
      abi: rareErc1155Abi,
      functionName: 'isApprovedForAll',
      args: [opts.accountAddress, opts.approvalManager],
    }),
  ]);
  if (balance < opts.plan.quantity) {
    throw new Error(
      `ERC1155 listing create requires ${opts.plan.quantity.toString()} units of token ` +
        `${opts.plan.contract}/${opts.plan.tokenId.toString()}, but ${opts.accountAddress} owns ${balance.toString()}.`,
    );
  }

  if (!approved) {
    return;
  }

  await opts.publicClient.simulateContract({
    address: opts.marketplace,
    abi: rareErc1155MarketplaceAbi,
    functionName: 'setSalePrices',
    args: [
      opts.plan.contract,
      opts.plan.currency,
      [{
        tokenId: opts.plan.tokenId,
        price: opts.plan.price,
        quantity: opts.plan.quantity,
        expirationTime: opts.plan.expirationTime,
      }],
      opts.plan.splitAddresses,
      opts.plan.splitRatios,
    ],
    account: opts.account,
  });
}

async function preflightErc1155ListingCreateBatch(opts: {
  publicClient: PublicClient;
  marketplace: Address;
  approvalManager: Address;
  account: Address | WalletAccount;
  accountAddress: Address;
  plan: Erc1155ListingCreateBatchPlan;
}): Promise<void> {
  const [balances, approved] = await Promise.all([
    Promise.all(opts.plan.items.map((item) => opts.publicClient.readContract({
      address: opts.plan.contract,
      abi: rareErc1155Abi,
      functionName: 'balanceOf',
      args: [opts.accountAddress, item.tokenId],
    }))),
    opts.publicClient.readContract({
      address: opts.plan.contract,
      abi: rareErc1155Abi,
      functionName: 'isApprovedForAll',
      args: [opts.accountAddress, opts.approvalManager],
    }),
  ]);
  opts.plan.items.forEach((item, index) => {
    const balance = balances[index] ?? 0n;
    if (balance < item.quantity) {
      throw new Error(
        `ERC1155 listing create requires ${item.quantity.toString()} units of token ` +
          `${opts.plan.contract}/${item.tokenId.toString()}, but ${opts.accountAddress} owns ${balance.toString()}.`,
      );
    }
  });

  if (!approved) {
    return;
  }

  await opts.publicClient.simulateContract({
    address: opts.marketplace,
    abi: rareErc1155MarketplaceAbi,
    functionName: 'setSalePrices',
    args: [
      opts.plan.contract,
      opts.plan.currency,
      opts.plan.items.map((item) => ({
        tokenId: item.tokenId,
        price: item.price,
        quantity: item.quantity,
        expirationTime: item.expirationTime,
      })),
      opts.plan.splitAddresses,
      opts.plan.splitRatios,
    ],
    account: opts.account,
  });
}

async function preflightErc1155ListingBuy(opts: {
  publicClient: PublicClient;
  marketplace: Address;
  approvalManager: Address;
  marketplaceSettings: Address;
  account: Address | WalletAccount;
  accountAddress: Address;
  plan: Erc1155ListingBuyPlan;
}): Promise<bigint> {
  const rawSale = await opts.publicClient.readContract({
    address: opts.marketplace,
    abi: rareErc1155MarketplaceAbi,
    functionName: 'getSalePrice',
    args: [opts.plan.contract, opts.plan.tokenId, opts.plan.seller],
  });
  const [currencyAddress, price, quantity, expirationTime] = normalizeSalePrice(rawSale);
  if (price === 0n || quantity === 0n) {
    throw new Error(
      `ERC1155 listing is not active for ${opts.plan.contract}/${opts.plan.tokenId.toString()} from seller ${opts.plan.seller}.`,
    );
  }
  if (expirationTime > 0n && nowSeconds() > expirationTime) {
    throw new Error(
      `ERC1155 listing for ${opts.plan.contract}/${opts.plan.tokenId.toString()} from seller ${opts.plan.seller} expired at ` +
        `${expirationTime.toString()}.`,
    );
  }
  if (!isAddressEqual(currencyAddress, opts.plan.currency)) {
    throw new Error(
      `ERC1155 listing currency changed during preflight. Expected ${opts.plan.currency}, read ${currencyAddress}.`,
    );
  }
  if (price !== opts.plan.price) {
    throw new Error(
      `ERC1155 listing price changed during preflight. Expected ${opts.plan.price.toString()} raw units, read ${price.toString()}.`,
    );
  }
  if (quantity < opts.plan.quantity) {
    throw new Error(
      `ERC1155 listing quantity is below the requested buy quantity. Requested ${opts.plan.quantity.toString()}, ` +
        `available ${quantity.toString()}.`,
    );
  }

  const requiredAmount = await calculateMarketplacePaymentAmountFromSettings(
    opts.publicClient,
    opts.marketplaceSettings,
    opts.plan.totalPrice,
  );
  const [sellerBalance, sellerApproved] = await Promise.all([
    opts.publicClient.readContract({
      address: opts.plan.contract,
      abi: rareErc1155Abi,
      functionName: 'balanceOf',
      args: [opts.plan.seller, opts.plan.tokenId],
    }),
    opts.publicClient.readContract({
      address: opts.plan.contract,
      abi: rareErc1155Abi,
      functionName: 'isApprovedForAll',
      args: [opts.plan.seller, opts.approvalManager],
    }),
  ]);
  if (sellerBalance < opts.plan.quantity) {
    throw new Error(
      `ERC1155 listing seller balance is below the requested buy quantity. Requested ${opts.plan.quantity.toString()}, ` +
        `seller owns ${sellerBalance.toString()}.`,
    );
  }
  if (!sellerApproved) {
    throw new Error(
      `ERC1155 listing seller ${opts.plan.seller} has not approved operator ${opts.approvalManager} for ${opts.plan.contract}.`,
    );
  }

  if (isAddressEqual(opts.plan.currency, ETH_ADDRESS)) {
    await opts.publicClient.simulateContract({
      address: opts.marketplace,
      abi: rareErc1155MarketplaceAbi,
      functionName: 'buyBatch',
      args: [
        opts.plan.contract,
        opts.plan.seller,
        opts.plan.currency,
        opts.plan.recipient,
        [{ tokenId: opts.plan.tokenId, price: opts.plan.price, quantity: opts.plan.quantity }],
      ],
      account: opts.account,
      value: requiredAmount,
    });
  } else {
    const buyerBalance = await opts.publicClient.readContract({
      address: opts.plan.currency,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [opts.accountAddress],
    });
    if (buyerBalance < requiredAmount) {
      throw new Error(
        `ERC1155 listing buy requires ${requiredAmount.toString()} raw payment units, ` +
          `but ${opts.accountAddress} owns ${buyerBalance.toString()}.`,
      );
    }
  }
  return requiredAmount;
}

async function prepareMarketplacePayment(opts: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Address | WalletAccount;
  accountAddress: Address;
  addresses: Erc1155Addresses;
  currency: Address;
  amount: bigint;
  autoApprove?: boolean;
}): Promise<{ value: bigint; requiredAmount: bigint; approvalTxHash?: Hash }> {
  const requiredAmount = await calculateMarketplacePaymentAmountFromSettings(
    opts.publicClient,
    opts.addresses.marketplaceSettings,
    opts.amount,
  );
  return preparePaymentAmountForSpender({
    publicClient: opts.publicClient,
    walletClient: opts.walletClient,
    account: opts.account,
    accountAddress: opts.accountAddress,
    spenderAddress: opts.addresses.erc20ApprovalManager,
    currency: opts.currency,
    requiredAmount,
    autoApprove: opts.autoApprove,
  });
}

async function approveMinterIfNeeded(opts: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Address | WalletAccount;
  contract: Address;
  minter: Address;
  autoApprove?: boolean;
}): Promise<Hash | undefined> {
  const isApproved = await opts.publicClient.readContract({
    address: opts.contract,
    abi: rareErc1155Abi,
    functionName: 'isApprovedMinter',
    args: [opts.minter],
  });
  if (isApproved) {
    return undefined;
  }
  if (opts.autoApprove !== true) {
    throw new MinterApprovalRequiredError({ collection: opts.contract, minter: opts.minter });
  }
  const approvalTxHash = await opts.walletClient.writeContract({
    address: opts.contract,
    abi: rareErc1155Abi,
    functionName: 'setMinterApproval',
    args: [opts.minter, true],
    account: opts.account,
    chain: undefined,
  });
  await waitForSuccessfulReceipt(opts.publicClient, approvalTxHash, 'erc1155 minter approval');
  return approvalTxHash;
}

async function readOptionalNoArgs(
  publicClient: PublicClient,
  address: Address,
  functionName: 'name' | 'symbol' | 'owner' | 'disabled' | 'MAX_BATCH_SIZE',
): Promise<unknown> {
  return readOptionalValue(async () => await publicClient.readContract({ address, abi: rareErc1155Abi, functionName }));
}

async function readOptionalAddress(
  publicClient: PublicClient,
  address: Address,
  functionName: 'isApprovedMinter',
  account: Address,
): Promise<unknown> {
  return readOptionalValue(async () => await publicClient.readContract({
    address,
    abi: rareErc1155Abi,
    functionName,
    args: [account],
  }));
}

async function readOptionalTokenId(
  publicClient: PublicClient,
  address: Address,
  functionName: 'uri' | 'maxSupplyForToken' | 'totalMintedForToken',
  tokenId: bigint,
): Promise<unknown> {
  return readOptionalValue(async () => await publicClient.readContract({
    address,
    abi: rareErc1155Abi,
    functionName,
    args: [tokenId],
  }));
}

async function readOptionalBalance(
  publicClient: PublicClient,
  address: Address,
  account: Address,
  tokenId: bigint,
): Promise<unknown> {
  return readOptionalValue(async () => await publicClient.readContract({
    address,
    abi: rareErc1155Abi,
    functionName: 'balanceOf',
    args: [account, tokenId],
  }));
}

async function readOptionalRoyalty(
  publicClient: PublicClient,
  address: Address,
  tokenId: bigint,
  price: bigint,
): Promise<unknown> {
  return readOptionalValue(async () => await publicClient.readContract({
    address,
    abi: rareErc1155Abi,
    functionName: 'royaltyInfo',
    args: [tokenId, price],
  }));
}

async function readOptionalValue(read: () => Promise<unknown>): Promise<unknown> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

async function simulateErc1155Checkout(opts: {
  publicClient: PublicClient;
  marketplace: Address;
  account: Address | WalletAccount;
  recipient: Address;
  items: Erc1155CheckoutContractItem[];
  value: bigint;
}): Promise<Erc1155CheckoutExecution> {
  const simulation = await opts.publicClient.simulateContract({
    address: opts.marketplace,
    abi: rareErc1155MarketplaceAbi,
    functionName: 'checkout',
    args: [opts.recipient, opts.items],
    account: opts.account,
    value: opts.value,
  });
  return normalizeCheckoutExecution(simulation.result, opts.marketplace);
}

function assertCheckoutPreflightCanSubmit(
  execution: Erc1155CheckoutExecution,
  opts: { allowApprovalFixable?: boolean } = {},
): void {
  if (execution.summary.filledCount > 0n) {
    return;
  }

  const allowApprovalFixable = opts.allowApprovalFixable ?? true;
  if (allowApprovalFixable && execution.items.some(isApprovalFixableCheckoutItem)) {
    return;
  }

  throw new Erc1155CheckoutAllItemsSkippedError(execution);
}

function isApprovalFixableCheckoutItem(item: Erc1155CheckoutExecution['items'][number]): boolean {
  return item.status === 'skipped' &&
    item.failureStage === erc1155CheckoutFailureStages.paymentCollection &&
    item.decodedFailure?.errorName === 'InsufficientCheckoutERC20Allowance' &&
    !isAddressEqual(item.currencyAddress, ETH_ADDRESS);
}

function normalizeCheckoutExecution(value: unknown, marketplace: Address): Erc1155CheckoutExecution {
  const summary = tupleField(value, 0, 'summary');
  const rawItems = tupleField(value, 1, 'items');
  if (!Array.isArray(rawItems)) {
    throw new Error('Unable to read ERC1155 checkout execution items.');
  }
  return shapeErc1155CheckoutExecution({
    marketplace,
    completed: {
      filledCount: BigInt(String(tupleField(summary, 0, 'filledCount'))),
      skippedCount: BigInt(String(tupleField(summary, 1, 'skippedCount'))),
      ethSpent: BigInt(String(tupleField(summary, 2, 'ethSpent'))),
      ethRefunded: BigInt(String(tupleField(summary, 3, 'ethRefunded'))),
    },
    items: rawItems.map(normalizeCheckoutProcessedItem),
  });
}

function normalizeCheckoutProcessedItem(value: unknown): Erc1155CheckoutProcessedItemInput {
  const failureData = normalizeHex(tupleField(value, 11, 'failureData'), 'failureData');
  const filled = normalizeBoolean(tupleField(value, 8, 'filled'), 'filled');
  return {
    itemIndex: BigInt(String(tupleField(value, 0, 'itemIndex'))),
    itemKind: Number(tupleField(value, 1, 'itemKind')),
    contractAddress: getAddress(String(tupleField(value, 2, 'contractAddress'))),
    tokenId: BigInt(String(tupleField(value, 3, 'tokenId'))),
    seller: getAddress(String(tupleField(value, 4, 'seller'))),
    currencyAddress: getAddress(String(tupleField(value, 5, 'currencyAddress'))),
    price: BigInt(String(tupleField(value, 6, 'price'))),
    quantity: BigInt(String(tupleField(value, 7, 'quantity'))),
    filled,
    failureStage: Number(tupleField(value, 9, 'failureStage')),
    reason: normalizeHex(tupleField(value, 10, 'reason'), 'reason'),
    failureData,
    totalPaid: BigInt(String(tupleField(value, 12, 'totalPaid'))),
    decodedFailure: filled ? undefined : decodeCheckoutFailure(failureData),
  };
}

function decodeCheckoutFailure(failureData: Hex): Erc1155CheckoutDecodedFailure | undefined {
  if (failureData === '0x' || failureData.length < 10) {
    return undefined;
  }

  const marketplaceDecoded = tryDecodeCheckoutFailure(rareErc1155MarketplaceAbi, failureData);
  if (marketplaceDecoded !== undefined) {
    return marketplaceDecoded;
  }

  return tryDecodeCheckoutFailure(genericSolidityErrorAbi, failureData);
}

function tryDecodeCheckoutFailure(
  abi: typeof rareErc1155MarketplaceAbi | typeof genericSolidityErrorAbi,
  data: Hex,
): Erc1155CheckoutDecodedFailure | undefined {
  try {
    const decoded = decodeErrorResult({ abi, data });
    return {
      errorName: decoded.errorName,
      args: decoded.args,
    };
  } catch {
    return undefined;
  }
}

function normalizeBoolean(value: unknown, name: string): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  throw new Error(`Unable to read ERC1155 contract result field "${name}" as boolean.`);
}

function normalizeDirectSaleConfig(value: unknown): readonly [Address, Address, bigint, bigint, bigint, readonly Address[], readonly number[]] {
  return [
    getAddress(String(tupleField(value, 0, 'seller'))),
    getAddress(String(tupleField(value, 1, 'currencyAddress'))),
    BigInt(String(tupleField(value, 2, 'price'))),
    BigInt(String(tupleField(value, 3, 'startTime'))),
    BigInt(String(tupleField(value, 4, 'maxMints'))),
    normalizeAddressArray(tupleField(value, 5, 'splitRecipients')),
    normalizeNumberArray(tupleField(value, 6, 'splitRatios')),
  ];
}

function normalizeSalePrice(value: unknown): readonly [Address, bigint, bigint, bigint, readonly Address[], readonly number[]] {
  return [
    getAddress(String(tupleField(value, 0, 'currencyAddress'))),
    BigInt(String(tupleField(value, 1, 'price'))),
    BigInt(String(tupleField(value, 2, 'quantity'))),
    BigInt(String(tupleField(value, 3, 'expirationTime'))),
    normalizeAddressArray(tupleField(value, 4, 'splitRecipients')),
    normalizeNumberArray(tupleField(value, 5, 'splitRatios')),
  ];
}

function normalizeOffer(value: unknown): readonly [Address, bigint, bigint, bigint, bigint] {
  return [
    getAddress(String(tupleField(value, 0, 'currencyAddress'))),
    BigInt(String(tupleField(value, 1, 'price'))),
    BigInt(String(tupleField(value, 2, 'quantity'))),
    BigInt(String(tupleField(value, 3, 'marketplaceFeeRemaining'))),
    BigInt(String(tupleField(value, 4, 'expirationTime'))),
  ];
}

function normalizeAllowlist(value: unknown): readonly [Hex, bigint] {
  return [
    normalizeHex(tupleField(value, 0, 'root'), 'root'),
    BigInt(String(tupleField(value, 1, 'endTimestamp'))),
  ];
}

function normalizeHex(value: unknown, name: string): Hex {
  if (typeof value === 'string' && isHex(value)) {
    return value;
  }
  throw new Error(`Unable to read ERC1155 contract result field "${name}" as hex.`);
}

function normalizeAddressBigintTuple(value: unknown): readonly [Address, bigint] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return [
    getAddress(String(tupleField(value, 0, 'receiver'))),
    BigInt(String(tupleField(value, 1, 'royaltyAmount'))),
  ];
}

function tupleField(value: unknown, index: number, name: string): unknown {
  if (Array.isArray(value)) {
    return value[index];
  }
  if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, name)) {
    return value[name];
  }
  throw new Error(`Unable to read ERC1155 contract result field "${name}".`);
}

function normalizeAddressArray(value: unknown): Address[] {
  return Array.isArray(value) ? value.map((entry) => getAddress(String(entry))) : [];
}

function normalizeNumberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.map((entry) => Number(entry)) : [];
}

function isAddressValue(value: unknown): value is Address {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}
