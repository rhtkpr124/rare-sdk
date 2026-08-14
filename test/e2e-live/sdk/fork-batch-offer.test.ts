import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddressEqual,
  zeroAddress,
  type Address,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  chainIds,
  supportedChains,
  viemChains,
  type SupportedChain,
} from '../../../src/contracts/addresses.js';
import { createRareClient } from '../../../src/sdk/client.js';
import type { RareClient } from '../../../src/sdk/client.js';
import type { BatchAuctionStatus } from '../../../src/sdk/batch-auction.js';
import { loadDotEnv } from '../../helpers/env.js';

loadDotEnv();

const describeFork = describe.sequential;
const localForkRpcUrl = 'http://127.0.0.1:8545';
const localForkHost = '127.0.0.1';
const localForkPort = '8545';
const localForkStartupTimeoutMs = 30_000;
const forkSellerPrivateKey = generatePrivateKey();
const forkBuyerPrivateKey = generatePrivateKey();
const forkAccountBalance = '0x3635c9adc5dea00000';
const tokenUri = 'ipfs://bafybeidznwopf6bnfakqbertnhohgh65usqlo7bhnehycurg4xmc5ebnm4/fork-sdk.json';
const releaseFixtureRuntimePrefix = '60003560e01c80638da5cb5b14601f578063755edd1714603d5760006000fd5b73';
const releaseFixtureRuntimeSuffix = '60005260206000f35b600160005260206000f3';

describeFork('SDK fork integration write paths', () => {
  it('creates, reads, revokes, and accepts batch offers through the SDK directly', async (ctx) => {
    const fork = await startLocalFork();
    if ('skipReason' in fork) {
      ctx.skip(fork.skipReason);
      return;
    }

    const publicClient = createForkPublicClient();
    let snapshotId: string | undefined;

    try {
      await fundForkAccounts(publicClient);
      snapshotId = await createForkSnapshot(publicClient);

      const chain = await detectForkChain(publicClient);
      const seller = createForkRareClient(chain, forkSellerPrivateKey);
      const buyer = createForkRareClient(chain, forkBuyerPrivateKey);

      const collection = await seller.rare.collection.deploy.erc721({
        name: `Rare SDK Fork Batch ${Date.now().toString(36)}`,
        symbol: 'RSFB',
        maxTokens: 4,
      });
      expect(collection.contract).toMatch(/^0x[0-9a-fA-F]{40}$/);

      const tokens = [
        await mintToken(seller.rare, collection.contract),
        await mintToken(seller.rare, collection.contract),
        await mintToken(seller.rare, collection.contract),
        await mintToken(seller.rare, collection.contract),
      ] as const;

      const revokeTree = seller.rare.utils.tree.build({
        content: JSON.stringify([
          { contractAddress: collection.contract, tokenId: tokens[0] },
          { contractAddress: collection.contract, tokenId: tokens[1] },
        ]),
        format: 'json',
        chainId: chainIds[chain],
      });
      const expiry = Math.floor(Date.now() / 1000) + 3_600;
      const created = await buyer.rare.offer.batch.create({
        root: revokeTree.root,
        price: '0.000001',
        endTime: expiry,
      });
      expect(created.creator).toBe(buyer.account);
      expect(created.root).toBe(revokeTree.root);

      const active = await seller.rare.offer.batch.status({
        creator: buyer.account,
        root: revokeTree.root,
      });
      expect(active.state).toBe('ACTIVE');
      expect(active.fillable).toBe(true);

      const revoked = await buyer.rare.offer.batch.revoke({ root: revokeTree.root });
      expect(revoked.root).toBe(revokeTree.root);
      const revokedStatus = await seller.rare.offer.batch.status({
        creator: buyer.account,
        root: revokeTree.root,
      });
      expect(revokedStatus.state).toBe('NONE');
      expect(revokedStatus.revoked).toBeNull();
      expect(revokedStatus.fillable).toBe(false);

      const acceptTree = seller.rare.utils.tree.build({
        content: JSON.stringify([
          { contractAddress: collection.contract, tokenId: tokens[2] },
          { contractAddress: collection.contract, tokenId: tokens[3] },
        ]),
        format: 'json',
        chainId: chainIds[chain],
      });
      const proof = seller.rare.utils.tree.proof({
        artifact: acceptTree,
        contractAddress: collection.contract,
        tokenId: tokens[2],
        chainId: chainIds[chain],
      });

      await buyer.rare.offer.batch.create({
        root: acceptTree.root,
        price: '0.000001',
        endTime: expiry,
      });
      const accepted = await seller.rare.offer.batch.accept({
        creator: buyer.account,
        root: proof.root,
        proof: proof.proof,
        contract: collection.contract,
        tokenId: tokens[2],
      });
      expect(accepted.seller).toBe(seller.account);
      expect(accepted.buyer).toBe(buyer.account);
      expect(accepted.root).toBe(acceptTree.root);

      const { token } = await buyer.rare.token.status({
        contract: collection.contract,
        tokenId: tokens[2],
      });
      expect(token).toBeDefined();
      if (token === undefined) {
        throw new Error('Expected token status after batch offer acceptance.');
      }
      expect(isAddressEqual(token.owner, buyer.account)).toBe(true);
    } finally {
      await cleanupFork(publicClient, fork, snapshotId);
    }
  }, 240_000);

  it('creates and buys batch listings through the SDK directly', async (ctx) => {
    const fork = await startLocalFork();
    if ('skipReason' in fork) {
      ctx.skip(fork.skipReason);
      return;
    }

    const publicClient = createForkPublicClient();
    let snapshotId: string | undefined;

    try {
      await fundForkAccounts(publicClient);
      snapshotId = await createForkSnapshot(publicClient);

      const chain = await detectForkChain(publicClient);
      const seller = createForkRareClient(chain, forkSellerPrivateKey);
      if (seller.rare.contracts.batchListing === undefined) {
        ctx.skip(`Batch listing marketplace is not deployed on ${chain}.`);
        return;
      }

      const collection = await seller.rare.collection.deploy.erc721({
        name: `Rare SDK Fork Batch Listing ${Date.now().toString(36)}`,
        symbol: 'RSFBL',
        maxTokens: 2,
      });
      const tokens = [
        await mintToken(seller.rare, collection.contract),
        await mintToken(seller.rare, collection.contract),
      ] as const;
      const tree = seller.rare.utils.tree.build({
        content: JSON.stringify([
          { contractAddress: collection.contract, tokenId: tokens[0] },
          { contractAddress: collection.contract, tokenId: tokens[1] },
        ]),
        format: 'json',
        chainId: chainIds[chain],
      });
      const apiFetch = nftMerkleRootFetch(tree.root);
      const listingSeller = createForkRareClient(chain, forkSellerPrivateKey, apiFetch);
      const listingBuyer = createForkRareClient(chain, forkBuyerPrivateKey, apiFetch);
      const listingArtifact = {
        root: tree.root,
        currency: zeroAddress,
        amount: '1000000000000',
        splitAddresses: [listingSeller.account, listingBuyer.account],
        splitRatios: [70, 30],
        tokens: tree.tokens.map((token) => ({
          contract: token.contractAddress,
          tokenId: token.tokenId,
        })),
      };

      const created = await listingSeller.rare.listing.batch.create({
        artifact: listingArtifact,
        autoApprove: true,
      });
      expect(created.root).toBe(tree.root);

      const status = await listingSeller.rare.listing.batch.status({
        root: tree.root,
        creator: listingSeller.account,
      });
      expect(status.hasListing).toBe(true);
      expect(status.root).toBe(tree.root);
      expect(status.amount).toBe(1000000000000n);
      expect(isAddressEqual(status.currencyAddress, zeroAddress)).toBe(true);
      expect(status.splitRecipients).toHaveLength(2);
      expect(isAddressEqual(status.splitRecipients[0]!, listingSeller.account)).toBe(true);
      expect(isAddressEqual(status.splitRecipients[1]!, listingBuyer.account)).toBe(true);
      expect(status.splitRatios).toEqual([70, 30]);

      const proof = listingSeller.rare.utils.tree.proof({
        artifact: tree,
        contractAddress: collection.contract,
        tokenId: tokens[0],
        chainId: chainIds[chain],
      });
      const bought = await listingBuyer.rare.listing.batch.buy({
        creator: listingSeller.account,
        currency: 'eth',
        price: '0.000001',
        proofArtifact: {
          root: proof.root,
          contract: proof.contractAddress,
          tokenId: proof.tokenId,
          proof: proof.proof,
        },
        autoApprove: true,
      });
      expect(bought.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
      await expectTokenOwner(listingBuyer.rare, collection.contract, tokens[0], listingBuyer.account);
    } finally {
      await cleanupFork(publicClient, fork, snapshotId);
    }
  }, 240_000);

  it('creates, reads, cancels, bids, and settles batch auctions through the SDK directly', async (ctx) => {
    const fork = await startLocalFork();
    if ('skipReason' in fork) {
      ctx.skip(fork.skipReason);
      return;
    }

    const publicClient = createForkPublicClient();
    let snapshotId: string | undefined;

    try {
      await fundForkAccounts(publicClient);
      snapshotId = await createForkSnapshot(publicClient);

      const chain = await detectForkChain(publicClient);
      const seller = createForkRareClient(chain, forkSellerPrivateKey);
      const buyer = createForkRareClient(chain, forkBuyerPrivateKey);

      const collection = await seller.rare.collection.deploy.erc721({
        name: `Rare SDK Fork Batch Auction ${Date.now().toString(36)}`,
        symbol: 'RSFBA',
        maxTokens: 4,
      });
      const tokens = [
        await mintToken(seller.rare, collection.contract),
        await mintToken(seller.rare, collection.contract),
        await mintToken(seller.rare, collection.contract),
        await mintToken(seller.rare, collection.contract),
      ] as const;

      const cancelTree = seller.rare.utils.tree.build({
        content: JSON.stringify([
          { contractAddress: collection.contract, tokenId: tokens[0] },
          { contractAddress: collection.contract, tokenId: tokens[1] },
        ]),
        format: 'json',
        chainId: chainIds[chain],
      });
      const cancelProof = seller.rare.utils.tree.proof({
        artifact: cancelTree,
        contractAddress: collection.contract,
        tokenId: tokens[0],
        chainId: chainIds[chain],
      });

      const createdForCancel = await seller.rare.auction.batch.create({
        root: cancelTree.root,
        artifact: cancelTree,
        price: '0.000001',
        endTime: Math.floor(Date.now() / 1000) + 60,
      });
      expect(createdForCancel.creator).toBe(seller.account);
      expect(createdForCancel.root).toBe(cancelTree.root);

      const configured = await seller.rare.auction.batch.status({
        creator: seller.account,
        root: cancelTree.root,
        proof: cancelProof.proof,
        contract: collection.contract,
        tokenId: tokens[0],
      });
      expectConfiguredBatchAuction(configured, seller.account, cancelTree.root);

      const cancelled = await seller.rare.auction.batch.cancel({});
      expect(cancelled.creator).toBe(seller.account);
      expect(cancelled.root).toBe(cancelTree.root);

      const settleTree = seller.rare.utils.tree.build({
        content: JSON.stringify([
          { contractAddress: collection.contract, tokenId: tokens[2] },
          { contractAddress: collection.contract, tokenId: tokens[3] },
        ]),
        format: 'json',
        chainId: chainIds[chain],
      });
      const settleProof = seller.rare.utils.tree.proof({
        artifact: settleTree,
        contractAddress: collection.contract,
        tokenId: tokens[2],
        chainId: chainIds[chain],
      });

      const settleAuctionDurationSeconds = 10;
      await seller.rare.auction.batch.create({
        root: settleTree.root,
        artifact: settleTree,
        price: '0.000001',
        endTime: Math.floor(Date.now() / 1000) + settleAuctionDurationSeconds,
      });
      const bid = await buyer.rare.auction.batch.bid({
        creator: seller.account,
        root: settleProof.root,
        proof: settleProof.proof,
        contract: collection.contract,
        tokenId: tokens[2],
        price: '0.000001',
      });
      expect(bid.bidder).toBe(buyer.account);
      expect(bid.creator).toBe(seller.account);
      expect(bid.root).toBe(settleTree.root);

      await advanceForkTime(publicClient, settleAuctionDurationSeconds + 1);
      const ended = await seller.rare.auction.batch.status({
        creator: seller.account,
        root: settleTree.root,
        proof: settleProof.proof,
        contract: collection.contract,
        tokenId: tokens[2],
      });
      expect(ended.state).toBe('ENDED');
      expect(ended.settlementEligible).toBe(true);

      const settled = await seller.rare.auction.batch.settle({
        contract: collection.contract,
        tokenId: tokens[2],
      });
      expect(settled.seller).toBe(seller.account);
      expect(settled.bidder).toBe(buyer.account);
      expect(settled.tokenId).toBe(BigInt(tokens[2]));

      await expectTokenOwner(buyer.rare, collection.contract, tokens[2], buyer.account);
    } finally {
      await cleanupFork(publicClient, fork, snapshotId);
    }
  }, 300_000);

  it('creates collection contracts and writes owner metadata and royalty settings through the SDK directly', async (ctx) => {
    const fork = await startLocalFork();
    if ('skipReason' in fork) {
      ctx.skip(fork.skipReason);
      return;
    }

    const publicClient = createForkPublicClient();
    let snapshotId: string | undefined;

    try {
      await fundForkAccounts(publicClient);
      snapshotId = await createForkSnapshot(publicClient);

      const chain = await detectForkChain(publicClient);
      const seller = createForkRareClient(chain, forkSellerPrivateKey);
      const buyer = createForkRareClient(chain, forkBuyerPrivateKey);

      const collection = await seller.rare.collection.deploy.erc721({
        name: `Rare SDK Fork Sovereign ${Date.now().toString(36)}`,
        symbol: 'RSFS',
        maxTokens: 8,
      });
      expect(collection.contract).toMatch(/^0x[0-9a-fA-F]{40}$/);

      const batchMint = await seller.rare.collection.mintBatch({
        contract: collection.contract,
        baseUri: 'ipfs://rare-sdk-fork/batch/',
        amount: 2,
      });
      expect(batchMint.contract).toBe(collection.contract);
      expect(batchMint.tokenCount).toBe(2n);
      expect(batchMint.owner).toBe(seller.account);

      const creator = await seller.rare.collection.getTokenCreator({
        contract: collection.contract,
        tokenId: batchMint.fromTokenId,
      });
      expect(creator.creator).toBe(seller.account);

      const defaultRoyalty = await seller.rare.collection.setDefaultRoyaltyReceiver({
        contract: collection.contract,
        receiver: buyer.account,
      });
      expect(defaultRoyalty.receiver).toBe(buyer.account);

      const tokenRoyalty = await seller.rare.collection.setTokenRoyaltyReceiver({
        contract: collection.contract,
        tokenId: batchMint.fromTokenId,
        receiver: seller.account,
      });
      expect(tokenRoyalty.receiver).toBe(seller.account);

      const royalty = await seller.rare.collection.royalty.status({
        contract: collection.contract,
        tokenId: batchMint.fromTokenId,
        price: 10_000,
      });
      expect(royalty.receiver).toBe(seller.account);
      expect(royalty.royaltyAmount).toBeGreaterThanOrEqual(0n);

      const lazyCollection = await seller.rare.collection.deploy.lazyErc721({
        name: `Rare SDK Fork Lazy ${Date.now().toString(36)}`,
        symbol: 'RSFL',
        maxTokens: 4,
      });
      const prepared = await seller.rare.collection.prepareLazyMint({
        contract: lazyCollection.contract,
        baseUri: 'ipfs://rare-sdk-fork/lazy/',
        amount: 2,
        minter: buyer.account,
      });
      expect(prepared.baseUri).toBe('ipfs://rare-sdk-fork/lazy/');
      expect(prepared.minter).toBe(buyer.account);

      const updatedBase = await seller.rare.collection.updateBaseUri({
        contract: lazyCollection.contract,
        baseUri: 'ipfs://rare-sdk-fork/updated/',
      });
      expect(updatedBase.baseUri).toBe('ipfs://rare-sdk-fork/updated/');

      const updatedToken = await seller.rare.collection.updateTokenUri({
        contract: lazyCollection.contract,
        tokenId: 1,
        tokenUri,
      });
      expect(updatedToken.tokenUri).toBe(tokenUri);
    } finally {
      await cleanupFork(publicClient, fork, snapshotId);
    }
  }, 300_000);

  it('configures and mints a RareMinter release through the SDK directly', async (ctx) => {
    const fork = await startLocalFork();
    if ('skipReason' in fork) {
      ctx.skip(fork.skipReason);
      return;
    }

    const publicClient = createForkPublicClient();
    let snapshotId: string | undefined;

    try {
      await fundForkAccounts(publicClient);
      snapshotId = await createForkSnapshot(publicClient);

      const chain = await detectForkChain(publicClient);
      const seller = createForkRareClient(chain, forkSellerPrivateKey);
      const buyer = createForkRareClient(chain, forkBuyerPrivateKey);
      const contract = await deployReleaseFixtureContract(chain, forkSellerPrivateKey, seller.account);

      const configured = await seller.rare.listing.release.configure({
        contract,
        price: 0,
        startTime: 1,
        maxMints: 2,
        splitAddresses: [seller.account],
        splitRatios: [100],
      });
      expect(configured.contract).toBe(contract);
      expect(configured.price).toBe(0n);
      expect(configured.maxMints).toBe(2n);

      const status = await buyer.rare.listing.release.status({
        contract,
        account: buyer.account,
      });
      expect(status.configured).toBe(true);
      expect(status.currentlyMintable).toBe(true);
      expect(status.account).toBe(buyer.account);

      const minted = await buyer.rare.listing.release.mint({
        contract,
        quantity: 2,
      });
      expect(minted.buyer).toBe(buyer.account);
      expect(minted.recipient).toBe(buyer.account);
      expect(minted.quantity).toBe(2);
      expect(minted.price).toBe(0n);
      expect(minted.tokenIds).toHaveLength(2);
    } finally {
      await cleanupFork(publicClient, fork, snapshotId);
    }
  }, 300_000);
});

type ForkRareClient = {
  account: Address;
  rare: RareClient;
};

function createForkPublicClient(chain?: SupportedChain): PublicClient {
  const transport = http(localForkRpcUrl, {
    retryCount: 1,
    timeout: 30_000,
  });

  return chain === undefined
    ? createPublicClient({ transport })
    : createPublicClient({ chain: viemChains[chain], transport });
}

function createForkRareClient(
  chain: SupportedChain,
  privateKey: `0x${string}`,
  apiFetch?: typeof fetch,
): ForkRareClient {
  const account = privateKeyToAccount(privateKey);
  const publicClient = createForkPublicClient(chain);
  const walletClient: WalletClient = createWalletClient({
    account,
    chain: viemChains[chain],
    transport: http(localForkRpcUrl),
  });
  return {
    account: account.address,
    rare: createRareClient({ publicClient, walletClient, apiFetch }),
  };
}

function nftMerkleRootFetch(root: `0x${string}`): typeof fetch {
  return async (input): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input);
    if (request.url.endsWith('/v1/merkle-roots/nfts')) {
      return new Response(JSON.stringify({ merkleRoot: root }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected rare-api request in fork batch listing test: ${request.url}`);
  };
}

async function detectForkChain(publicClient: PublicClient): Promise<SupportedChain> {
  const chainId = await publicClient.getChainId();
  const chain = supportedChains.find((candidate) => chainIds[candidate] === chainId);
  if (chain === undefined) {
    throw new Error(`Local fork RPC returned unsupported chain id ${chainId}.`);
  }
  return chain;
}

async function fundForkAccounts(publicClient: PublicClient): Promise<void> {
  try {
    await Promise.all([forkSellerPrivateKey, forkBuyerPrivateKey].map(async (privateKey) => {
      await requestForkRpc(publicClient, {
        method: 'anvil_setBalance',
        params: [privateKeyToAccount(privateKey).address, forkAccountBalance],
      });
    }));
  } catch (error) {
    throw new Error(
      `SDK fork integration requires the local fork RPC at ${localForkRpcUrl} to support anvil_setBalance.`,
      { cause: error },
    );
  }
}

async function mintToken(rare: RareClient, contract: Address): Promise<string> {
  const minted = await rare.collection.mint({ contract, tokenUri });
  return minted.tokenId.toString();
}

async function expectTokenOwner(
  rare: RareClient,
  contract: Address,
  tokenId: string,
  expectedOwner: Address,
): Promise<void> {
  const { token } = await rare.token.status({ contract, tokenId });
  expect(token).toBeDefined();
  if (token === undefined) {
    throw new Error('Expected token status for owner assertion.');
  }
  expect(isAddressEqual(token.owner, expectedOwner)).toBe(true);
}

function expectConfiguredBatchAuction(
  status: BatchAuctionStatus,
  seller: Address,
  root: `0x${string}`,
): void {
  expect(status.seller).toBe(seller);
  expect(status.root).toBe(root);
  expect(status.hasRootConfig).toBe(true);
  expect(status.state).toBe('RESERVE_NOT_MET');
}

async function advanceForkTime(publicClient: PublicClient, seconds: number): Promise<void> {
  await requestForkRpc(publicClient, {
    method: 'evm_increaseTime',
    params: [seconds],
  });
  await requestForkRpc(publicClient, {
    method: 'evm_mine',
    params: [],
  });
}

async function deployReleaseFixtureContract(
  chain: SupportedChain,
  privateKey: `0x${string}`,
  owner: Address,
): Promise<Address> {
  const account = privateKeyToAccount(privateKey);
  const publicClient = createForkPublicClient(chain);
  const walletClient = createWalletClient({
    account,
    chain: viemChains[chain],
    transport: http(localForkRpcUrl),
  });
  const txHash = await walletClient.sendTransaction({
    account,
    chain: viemChains[chain],
    data: releaseFixtureBytecode(owner),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (!receipt.contractAddress) {
    throw new Error('Release fixture deployment did not return a contract address.');
  }
  return receipt.contractAddress;
}

function releaseFixtureBytecode(owner: Address): `0x${string}` {
  const ownerBytes = owner.slice(2).toLowerCase();
  return `0x6048600c60003960486000f3${releaseFixtureRuntimePrefix}${ownerBytes}${releaseFixtureRuntimeSuffix}`;
}

type LocalFork = {
  readonly stop: () => Promise<void>;
};

type LocalForkStartResult = LocalFork | {
  readonly skipReason: string;
};

async function cleanupFork(
  publicClient: PublicClient,
  fork: LocalFork,
  snapshotId: string | undefined,
): Promise<void> {
  try {
    if (snapshotId !== undefined) {
      await revertForkSnapshot(publicClient, snapshotId);
    }
  } finally {
    await fork.stop();
  }
}

async function startLocalFork(): Promise<LocalForkStartResult> {
  const existingForkHealth = await getLocalForkHealth();
  if (existingForkHealth.state === 'ready') {
    return {
      stop: async (): Promise<void> => {},
    };
  }
  if (existingForkHealth.state === 'unhealthy') {
    throw new Error(
      `Local fork RPC at ${localForkRpcUrl} is responding but is not usable for SDK fork integration tests. Stop the existing Anvil process on port ${localForkPort} and rerun.\n${existingForkHealth.reason}`,
    );
  }

  const forkUrl = process.env.TEST_RPC_URL?.trim();
  if (!forkUrl) {
    return {
      skipReason: 'TEST_RPC_URL is required as the upstream RPC for the local Anvil fork.',
    };
  }

  const output = createProcessOutputBuffer();
  const child = spawn('anvil', [
    '--host',
    localForkHost,
    '--port',
    localForkPort,
    '--fork-url',
    forkUrl,
  ], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', output.append);
  child.stderr.on('data', output.append);

  let spawnError: Error | undefined;
  child.once('error', (error) => {
    spawnError = error;
  });

  const deadline = Date.now() + localForkStartupTimeoutMs;
  while (Date.now() < deadline) {
    if (spawnError !== undefined) {
      if (isCommandNotFoundError(spawnError)) {
        return {
          skipReason: 'Anvil is required for SDK fork integration tests but was not found on PATH.',
        };
      }
      throw spawnError;
    }

    if (child.exitCode !== null) {
      throw new Error(`Anvil exited before the local fork was ready.\n${output.read()}`);
    }

    if ((await getLocalForkHealth()).state === 'ready') {
      return {
        stop: async (): Promise<void> => {
          await stopProcess(child);
        },
      };
    }

    await sleep(250);
  }

  await stopProcess(child);
  throw new Error(`Timed out waiting for Anvil local fork at ${localForkRpcUrl}.\n${output.read()}`);
}

type LocalForkHealth = {
  readonly state: 'ready' | 'unreachable';
} | {
  readonly reason: string;
  readonly state: 'unhealthy';
};

async function getLocalForkHealth(): Promise<LocalForkHealth> {
  const chainId = await requestLocalForkRpc('eth_chainId', []);
  if (!chainId.ok) {
    return chainId.reachable
      ? { state: 'unhealthy', reason: chainId.reason }
      : { state: 'unreachable' };
  }

  const pendingTransactionCount = await requestLocalForkRpc(
    'eth_getTransactionCount',
    [zeroAddress, 'pending'],
  );
  if (!pendingTransactionCount.ok) {
    return { state: 'unhealthy', reason: pendingTransactionCount.reason };
  }

  return { state: 'ready' };
}

type LocalForkRpcResult = {
  readonly ok: true;
  readonly result: unknown;
} | {
  readonly ok: false;
  readonly reachable: boolean;
  readonly reason: string;
};

async function requestLocalForkRpc(method: string, params: readonly unknown[]): Promise<LocalForkRpcResult> {
  try {
    const response = await fetch(localForkRpcUrl, {
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method,
        params,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) {
      return {
        ok: false,
        reachable: true,
        reason: `RPC ${method} returned HTTP ${response.status}.`,
      };
    }

    const body: unknown = await response.json();
    if (!isRecord(body)) {
      return {
        ok: false,
        reachable: true,
        reason: `RPC ${method} returned a non-object response.`,
      };
    }
    if ('result' in body) {
      return { ok: true, result: body.result };
    }

    return {
      ok: false,
      reachable: true,
      reason: `RPC ${method} failed: ${rpcErrorMessage(body.error)}`,
    };
  } catch (error) {
    return {
      ok: false,
      reachable: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function rpcErrorMessage(error: unknown): string {
  if (isRecord(error) && typeof error.message === 'string') {
    return error.message;
  }
  return JSON.stringify(error);
}

async function createForkSnapshot(publicClient: PublicClient): Promise<string> {
  try {
    const snapshotId = await requestForkRpc(publicClient, {
      method: 'evm_snapshot',
      params: [],
    });
    if (typeof snapshotId !== 'string') {
      throw new Error(`evm_snapshot returned ${typeof snapshotId}`);
    }
    return snapshotId;
  } catch (error) {
    throw new Error(
      `SDK fork integration requires the local fork RPC at ${localForkRpcUrl} to support evm_snapshot.`,
      { cause: error },
    );
  }
}

async function revertForkSnapshot(publicClient: PublicClient, snapshotId: string): Promise<void> {
  let evmRevertError: unknown;
  try {
    const reverted = await requestForkRpc(publicClient, {
      method: 'evm_revert',
      params: [snapshotId],
    });
    if (reverted === true) {
      return;
    }
  } catch (error) {
    evmRevertError = error;
  }

  try {
    const reverted = await requestForkRpc(publicClient, {
      method: 'anvil_revert',
      params: [snapshotId],
    });
    if (reverted === true) {
      return;
    }
  } catch (error) {
    throw new Error('Failed to revert SDK fork integration snapshot.', { cause: error });
  }

  throw new Error('Failed to revert SDK fork integration snapshot.', { cause: evmRevertError });
}

function createProcessOutputBuffer(): {
  readonly append: (chunk: string) => void;
  readonly read: () => string;
} {
  let output = '';
  return {
    append: (chunk: string): void => {
      output = `${output}${chunk}`.slice(-8_000);
    },
    read: (): string => output.trim(),
  };
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill('SIGTERM');
  const closed = await waitForClose(child, 5_000);
  if (!closed) {
    child.kill('SIGKILL');
    await waitForClose(child, 5_000);
  }
}

async function waitForClose(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    const close = (): void => {
      cleanup();
      resolve(true);
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      child.off('close', close);
    };
    child.once('close', close);
  });
}

function requestForkRpc(
  publicClient: PublicClient,
  request: { method: string; params: readonly unknown[] },
): Promise<unknown> {
  // eslint-disable-next-line no-restricted-syntax
  return publicClient.request(request as never);
}

function isCommandNotFoundError(error: Error): boolean {
  return 'code' in error && error.code === 'ENOENT';
}
