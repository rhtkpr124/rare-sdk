import {
  type Address,
  type PublicClient,
} from 'viem';
import { auctionAbi } from '../contracts/abis/auction.js';
import { tokenAbi } from '../contracts/abis/token.js';
import { ETH_ADDRESS, type SupportedChain } from '../contracts/addresses.js';
import type { RareClientConfig } from './types/client.js';
import type { OfferMarketplaceNamespace } from './types/offer.js';
import { approveNftContractIfNeeded, runWithApprovalSideEffectAlert } from './approvals-shell.js';
import { preparePaymentForSpender } from './payments-shell.js';
import { requireWallet } from './wallet-shell.js';
import { requireInput } from './validation-core.js';
import {
  planOfferAccept,
  planOfferCancel,
  planOfferCreate,
  planOfferStatus,
  shapeOfferStatus,
} from './marketplace-core.js';
import { resolveCurrencyForSdk } from './currency.js';

export type * from './types/offer.js';

export function createOfferNamespace(
  publicClient: PublicClient,
  config: RareClientConfig,
  chain: SupportedChain,
  addresses: { auction: Address },
): OfferMarketplaceNamespace {
  return {
    async create(params): ReturnType<OfferMarketplaceNamespace['create']> {
      const { walletClient, account, accountAddress } = requireWallet(config);
      const currency = params.currency === undefined ? ETH_ADDRESS : resolveCurrencyForSdk(params.currency, chain).address;
      const price = requireInput(params.price, 'price');
      const amount = price;
      const plan = planOfferCreate({ ...params, price: amount, currency });

      const payment = await preparePaymentForSpender({
        publicClient, walletClient, account, accountAddress,
        marketplaceSettingsSource: addresses.auction,
        spenderAddress: addresses.auction,
        currency: plan.currency,
        amount: plan.amount,
        autoApprove: params.autoApprove,
      });

      const { txHash, receipt } = await runWithApprovalSideEffectAlert({
        operation: 'offer create',
        approvals: [{
          type: 'erc20',
          approvalTxHash: payment.approvalTxHash,
          target: plan.currency,
          spender: addresses.auction,
        }],
        run: async () => {
          const targetTxHash = await walletClient.writeContract({
            address: addresses.auction,
            abi: auctionAbi,
            functionName: 'offer',
            args: [params.contract, plan.tokenId, plan.currency, plan.amount, false],
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

    async cancel(params): ReturnType<OfferMarketplaceNamespace['cancel']> {
      const { walletClient, account } = requireWallet(config);
      const currency = params.currency === undefined ? ETH_ADDRESS : resolveCurrencyForSdk(params.currency, chain).address;
      const plan = planOfferCancel({ ...params, currency });

      const targetTxHash = await walletClient.writeContract({
        address: addresses.auction,
        abi: auctionAbi,
        functionName: 'cancelOffer',
        args: [params.contract, plan.tokenId, plan.currency],
        account,
        chain: undefined,
      });

      const targetReceipt = await publicClient.waitForTransactionReceipt({ hash: targetTxHash });
      return { txHash: targetTxHash, receipt: targetReceipt };
    },

    async accept(params): ReturnType<OfferMarketplaceNamespace['accept']> {
      const { walletClient, account, accountAddress } = requireWallet(config);
      const currency = params.currency === undefined ? ETH_ADDRESS : resolveCurrencyForSdk(params.currency, chain).address;
      const price = requireInput(params.price, 'price');
      const amount = price;
      const plan = planOfferAccept({ ...params, price: amount, currency }, accountAddress);

      const approvalTxHash = await approveNftContractIfNeeded({
        publicClient,
        walletClient,
        account,
        accountAddress,
        nftAddress: params.contract,
        operator: addresses.auction,
        autoApprove: params.autoApprove,
      });

      const { txHash, receipt } = await runWithApprovalSideEffectAlert({
        operation: 'offer accept',
        approvals: [{
          type: 'nft',
          approvalTxHash,
          target: params.contract,
          operator: addresses.auction,
        }],
        run: async () => {
          const targetTxHash = await walletClient.writeContract({
            address: addresses.auction,
            abi: auctionAbi,
            functionName: 'acceptOffer',
            args: [
              params.contract,
              plan.tokenId,
              plan.currency,
              plan.amount,
              plan.splitAddresses,
              plan.splitRatios,
            ],
            account,
            chain: undefined,
          });

          const targetReceipt = await publicClient.waitForTransactionReceipt({ hash: targetTxHash });
          return { txHash: targetTxHash, receipt: targetReceipt };
        },
      });
      return { txHash, receipt, approvalTxHash };
    },

    async status(params): ReturnType<OfferMarketplaceNamespace['status']> {
      const currency = params.currency === undefined ? ETH_ADDRESS : resolveCurrencyForSdk(params.currency, chain).address;
      const plan = planOfferStatus({ ...params, currency });

      const [offerResult, ownerResult, delayResult] = await publicClient.multicall({
        contracts: [
          {
            address: addresses.auction,
            abi: auctionAbi,
            functionName: 'tokenCurrentOffers',
            args: [params.contract, plan.tokenId, plan.currency],
          },
          {
            address: params.contract,
            abi: tokenAbi,
            functionName: 'ownerOf',
            args: [plan.tokenId],
          },
          {
            address: addresses.auction,
            abi: auctionAbi,
            functionName: 'offerCancelationDelay',
          },
        ],
      });

      if (offerResult.status !== 'success') {
        throw offerResult.error;
      }
      if (ownerResult.status !== 'success') {
        throw ownerResult.error;
      }
      if (delayResult.status !== 'success') {
        throw delayResult.error;
      }

      const wallet = config.account ?? config.walletClient?.account?.address ?? null;

      return shapeOfferStatus(offerResult.result, {
        currency: plan.currency,
        tokenOwner: ownerResult.result,
        cancellationDelay: delayResult.result,
        wallet,
        nowSeconds: BigInt(Math.floor(Date.now() / 1000)),
      });
    },
  };
}
