import { erc20Abi, isAddressEqual, parseEventLogs, type Address, type Hex, type PublicClient } from 'viem';
import { cartAbi } from '../contracts/abis/cart.js';
import { cartLensAbi } from '../contracts/abis/cart-lens.js';
import { ETH_ADDRESS, type SupportedChain } from '../contracts/addresses.js';
import { approvalAbi, runWithApprovalSideEffectAlert, waitForApprovalState } from './approvals-shell.js';
import { buildCartListingAuthorization, buildCartListingRootArtifact, buildCartOrder, cartDomain, getCartListingArtifactEntry, hashCartListing, hashCartListingRoot, hashCartOrder, parseCartListingRootArtifact, validateCartCheckoutIntent, validateCartCheckoutPreparationForPurchase, validateCartListingRootArtifact } from './cart-core.js';
import { PaymentApprovalRequiredError, preparePaymentAmountForSpender } from './payments-shell.js';
import { waitForSuccessfulTransactionReceipt } from './transaction-receipt.js';
import type { RareClientConfig } from './types/client.js';
import type { CartCheckoutParams, CartNamespace, CartPurchaseParams, CartPurchaseResult, CartSignedOrder, CartTypedDataSigner } from './types/cart.js';
import { requireWallet } from './wallet-shell.js';
import { createCartApiNamespace } from './cart-api.js';
import { addCartListingSalt, generateCartListingSalt } from './cart-listing-shell.js';

export type * from './types/cart.js';
export type * from './types/cart-api.js';

export class CartPreparationError extends Error {
  readonly code: string;
  readonly details: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message); this.name = 'CartPreparationError'; this.code = code; this.details = details;
  }
}
export class CartVerificationError extends Error {
  readonly txHash: Hex; readonly orderId: Hex; readonly cart: Address;
  constructor(message: string, context: { txHash: Hex; orderId: Hex; cart: Address }) {
    super(message); this.name = 'CartVerificationError'; this.txHash = context.txHash;
    this.orderId = context.orderId; this.cart = context.cart;
  }
}
export class CartExecutionError extends Error {
  readonly orderId: Hex; readonly cart: Address;
  constructor(message: string, context: { orderId: Hex; cart: Address; cause: unknown }) {
    super(message, { cause: context.cause }); this.name = 'CartExecutionError'; this.orderId = context.orderId; this.cart = context.cart;
  }
}

export function createCartNamespace(
  publicClient: PublicClient,
  config: RareClientConfig,
  chain: SupportedChain,
  chainId: number,
  addresses: { cart?: Address; cartLens?: Address },
): CartNamespace {
  const api = createCartApiNamespace({ baseUrl: config.apiBaseUrl, fetch: config.apiFetch }, { chainId, cartAddress: addresses.cart });
  const requireCart = (): Address => {
    if (!addresses.cart) throw new Error(`Cart is not deployed on "${chain}". Available on: sepolia.`);
    return addresses.cart;
  };
  const writeSimple = async (functionName: 'cancelListing' | 'cancelListingRoot' | 'invalidateListingNonce', args: readonly Hex[] = []) => {
    const cart = requireCart(); const { walletClient, account } = requireWallet(config);
    const txHash = await walletClient.writeContract({ address: cart, abi: cartAbi, functionName, args, account, chain: undefined } as Parameters<typeof walletClient.writeContract>[0]);
    const receipt = await waitForSuccessfulTransactionReceipt(publicClient, { txHash, operation: `cart ${functionName}`, marketplace: cart });
    return { txHash, receipt };
  };
  const setApproval = async (tokenContract: Address, approved: boolean) => {
    const cart = requireCart();
    const { walletClient, account, accountAddress } = requireWallet(config);
    const currentApproval = await publicClient.readContract({
      address: tokenContract,
      abi: approvalAbi,
      functionName: 'isApprovedForAll',
      args: [accountAddress, cart],
    });
    if (currentApproval === approved) return { txHash: undefined };

    const txHash = await walletClient.writeContract({
      address: tokenContract,
      abi: approvalAbi,
      functionName: 'setApprovalForAll',
      args: [cart, approved],
      account,
      chain: undefined,
    });
    const receipt = await waitForSuccessfulTransactionReceipt(publicClient, {
      txHash,
      operation: approved ? 'approve collection for Cart' : 'revoke collection approval for Cart',
      marketplace: tokenContract,
    });
    await waitForApprovalState(publicClient, tokenContract, accountAddress, cart, approved);
    return { txHash, receipt };
  };

  return {
    api,
    approval: {
      status(tokenContract, owner) {
        return publicClient.readContract({
          address: tokenContract,
          abi: approvalAbi,
          functionName: 'isApprovedForAll',
          args: [owner, requireCart()],
        });
      },
      approve(tokenContract) { return setApproval(tokenContract, true); },
      revoke(tokenContract) { return setApproval(tokenContract, false); },
    },
    listing: {
      createSalt: generateCartListingSalt,
      buildRoot(params) {
        return buildCartListingRootArtifact({
          ...params,
          listings: params.listings.map(addCartListingSalt),
        });
      },
      parseArtifact: parseCartListingRootArtifact,
      validateArtifact: validateCartListingRootArtifact,
      getEntry: getCartListingArtifactEntry,
      buildAuthorization: buildCartListingAuthorization,
      async signRoot(artifact, signer) {
        if (!isAddressEqual(artifact.seller, signer.address)) throw new Error('Listing Root signer does not match artifact seller.');
        const root = { listingsRoot: artifact.root.listingsRoot, nonce: BigInt(artifact.root.nonce), deadline: BigInt(artifact.root.deadline) };
        const signature = await signer.signTypedData({ domain: cartDomain(artifact.chainId, artifact.cart), primaryType: 'ListingRoot', types: { ListingRoot: [
          { name: 'listingsRoot', type: 'bytes32' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
        ] }, message: root });
        return { ...artifact, signature };
      },
      cancel(listingDigest) { return writeSimple('cancelListing', [listingDigest]); },
      cancelRoot(rootDigest) { return writeSimple('cancelListingRoot', [rootDigest]); },
      invalidateNonce() { return writeSimple('invalidateListingNonce'); },
    },
    order: {
      build(params) { return buildCartOrder(params); },
      async sign(order, signer) { return signCartOrder(order, signer, chainId, requireCart()); },
    },
    checkout: {
      prepare(intent) {
        const validation = validateCartCheckoutIntent(intent);
        if (!validation.isValid) throw new CartPreparationError('invalid_intent', 'Cart checkout intent is invalid.', validation.issues);
        return api.checkout.prepare(validation.value);
      },
      purchase(params) { return purchaseCartCheckout(publicClient, config, api, chainId, requireCart(), addresses.cartLens, params); },
    },
  };
}

async function purchaseCartCheckout(
  publicClient: PublicClient,
  config: RareClientConfig,
  api: ReturnType<typeof createCartApiNamespace>,
  chainId: number,
  cart: Address,
  lens: Address | undefined,
  params: CartPurchaseParams,
): Promise<CartPurchaseResult> {
  const validation = validateCartCheckoutPreparationForPurchase(params.preparation, { chainId: BigInt(chainId), cart });
  if (!validation.isValid) {
    throw new CartPreparationError('invalid_preparation', 'Cart checkout preparation cannot be purchased.', validation.issues);
  }

  const { accountAddress } = requireWallet(config);
  const paymentCurrency = params.preparation.intent.paymentCurrency;
  if (!isAddressEqual(paymentCurrency, ETH_ADDRESS)) {
    const allowance = await publicClient.readContract({
      address: paymentCurrency,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [accountAddress, cart],
    });
    if (allowance < params.preparation.paymentAmount && params.autoApprove !== true) {
      throw new PaymentApprovalRequiredError({ requiredAmount: params.preparation.paymentAmount, spenderAddress: cart });
    }
  }

  const preparedPurchase = await api.checkout.purchase(params.preparation);
  const execution = await executeCartCheckout(publicClient, config, chainId, cart, lens, {
    ...preparedPurchase.executePurchase,
    autoApprove: params.autoApprove,
  });
  return { ...execution, preparation: params.preparation, preparedPurchase };
}

async function signCartOrder(value: Omit<CartSignedOrder, 'platformSignature'>, signer: CartTypedDataSigner, chainId: number, cart: Address): Promise<CartSignedOrder> {
  const platformSignature = await signer.signTypedData({ domain: cartDomain(chainId, cart), primaryType: 'PurchaseOrder', types: { PurchaseOrder: [
    { name: 'orderId', type: 'bytes32' }, { name: 'paymentCurrency', type: 'address' }, { name: 'deadline', type: 'uint256' },
    { name: 'paymentAmount', type: 'uint256' }, { name: 'orderLinesHash', type: 'bytes32' },
    { name: 'payoutRouteHash', type: 'bytes32' }, { name: 'fulfillmentActionsHash', type: 'bytes32' },
  ] }, message: value.order });
  return { ...value, platformSignature };
}

async function executeCartCheckout(publicClient: PublicClient, config: RareClientConfig, chainId: number, cart: Address, lens: Address | undefined, params: CartCheckoutParams) {
  const { walletClient, account, accountAddress } = requireWallet(config);
  if (lens) {
    const results = await readCartLensPreflight(publicClient, lens, chainId, cart, params);
    if (!results.envelope.valid) throw new CartPreparationError(`lens_${results.envelope.code}`, 'Cart Lens rejected the Purchase Order.', results.envelope);
    const invalidListing = results.listings.find((result) => !result.valid);
    if (invalidListing) throw new CartPreparationError(`lens_${invalidListing.code}`, 'Cart Lens rejected a Listing authorization.', invalidListing);
  }
  const payment = await preparePaymentAmountForSpender({ publicClient, walletClient, account, accountAddress,
    spenderAddress: cart, currency: params.order.paymentCurrency, requiredAmount: params.order.paymentAmount, autoApprove: params.autoApprove });
  return runWithApprovalSideEffectAlert({ operation: 'cart checkout', approvals: [{ type: 'erc20', approvalTxHash: payment.approvalTxHash,
    target: params.order.paymentCurrency, spender: cart }], run: async () => {
      const simulation = await simulateCartCheckout(publicClient, cart, accountAddress, payment.value, params, 'Cart checkout simulation failed.');
      const txHash = await walletClient.writeContract({ ...simulation.request, account, chain: undefined });
      const receipt = await waitForSuccessfulTransactionReceipt(publicClient, { txHash, operation: 'cart checkout', marketplace: cart });
      const purchaseLogs = parseEventLogs({ abi: cartAbi, logs: receipt.logs, eventName: 'PurchaseExecuted' }).filter((log) => log.args.orderId === params.order.orderId);
      const lineLogs = parseEventLogs({ abi: cartAbi, logs: receipt.logs, eventName: 'OrderLineSettled' }).filter((log) => log.args.orderId === params.order.orderId);
      const actionLogs = parseEventLogs({ abi: cartAbi, logs: receipt.logs, eventName: 'FulfillmentActionExecuted' }).filter((log) => log.args.orderId === params.order.orderId);
      const executed = await publicClient.readContract({ address: cart, abi: cartAbi, functionName: 'executedOrderIds', args: [params.order.orderId] });
      const expectedActionEvents = params.actions.reduce((count, action) =>
        count + (params.lines[Number(action.lineIndex)]?.fulfillmentKind === 4 ? Number(action.quantity) : 1), 0);
      if (purchaseLogs.length !== 1 || lineLogs.length !== params.lines.length || actionLogs.length !== expectedActionEvents || !executed) {
        throw new CartVerificationError('Cart checkout receipt or post-write state did not match the signed Purchase Order.', { txHash, orderId: params.order.orderId, cart });
      }
      const purchase = purchaseLogs[0]!;
      if (!isAddressEqual(purchase.args.payer, accountAddress) || !isAddressEqual(purchase.args.paymentCurrency, params.order.paymentCurrency) || purchase.args.paymentAmount !== params.order.paymentAmount) {
        throw new CartVerificationError('PurchaseExecuted values did not match the checkout plan.', { txHash, orderId: params.order.orderId, cart });
      }
      return { txHash, receipt, ...(payment.approvalTxHash === undefined ? {} : { approvalTxHash: payment.approvalTxHash }),
        orderId: params.order.orderId, payer: accountAddress,
        paymentCurrency: params.order.paymentCurrency, paymentAmount: params.order.paymentAmount,
        lineCount: lineLogs.length, actionCount: actionLogs.length };
    } });
}

async function readCartLensPreflight(publicClient: PublicClient, lens: Address, chainId: number, cart: Address, params: CartCheckoutParams) {
  const envelope = await publicClient.readContract({ address: lens, abi: cartLensAbi, functionName: 'validatePurchaseEnvelope',
    args: [cart, params.order, params.lines, params.route, params.actions, params.platformSignature] });
  const listings = await Promise.all(params.listings.map(async (listing, listingIndex) => {
    const rootIndex = Number(params.authorization.listingRootIndexes[listingIndex]);
    const root = params.authorization.listingRoots[rootIndex];
    const rootSignature = params.authorization.listingRootSignatures[rootIndex];
    const proof = params.authorization.listingProofs[listingIndex];
    if (!root || !rootSignature || !proof) throw new CartPreparationError('invalid_listing_authorization',
      `Listing authorization at index ${listingIndex} is incomplete.`);
    const digest = hashCartListing(listing, chainId, cart);
    const requestedQuantity = params.lines.find((line) => line.listingDigest === digest)?.quantity ?? 0n;
    return publicClient.readContract({ address: lens, abi: cartLensAbi, functionName: 'validateListing',
      args: [cart, listing, root, rootSignature, proof, requestedQuantity] });
  }));
  return { envelope, listings };
}

async function simulateCartCheckout(publicClient: PublicClient, cart: Address, account: Address, value: bigint,
  params: CartCheckoutParams, message: string) {
  try {
    return await publicClient.simulateContract({ address: cart, abi: cartAbi, functionName: 'executePurchase',
      args: [params.order, params.lines, params.listings, params.authorization, params.route, params.actions, params.platformSignature],
      account, value });
  } catch (cause) {
    throw new CartExecutionError(message, { orderId: params.order.orderId, cart, cause });
  }
}

export const cartDigestHelpers = { hashCartListingRoot, hashCartOrder };
