import { describe, expect, it } from 'vitest';
import { parseEther, parseUnits, zeroAddress } from 'viem';
import {
  ZERO_BYTES32,
  assertReleaseAllowlistConfigMatches,
  assertReleaseContractOwner,
  assertReleaseLimitMatches,
  buildReleaseAllowlistArtifact,
  buildReleaseAllowlistArtifactFromInput,
  getReleaseAllowlistProof,
  normalizeReleasePrice,
  normalizeReleaseStartTime,
  parseReleaseAllowlistArtifact,
  parseReleaseAllowlistCsv,
  planReleaseAllowlistConfig,
  planReleaseConfigure,
  planReleaseDirectSaleMint,
  planReleaseLimitConfig,
  preflightReleaseDirectSaleMint,
  resolveReleaseSplits,
  shapeReleaseAllowlistConfig,
  shapeReleaseLimitConfig,
  shapeReleaseMintTokenRange,
  shapeReleaseStatus,
  verifyReleaseAllowlistProof,
} from '../../../src/sdk/release-core.js';

const ETH_ADDRESS = zeroAddress;
const accountAddress = '0x0000000000000000000000000000000000000001' as const;
const recipientAddress = '0x0000000000000000000000000000000000000002' as const;
const erc20Currency = '0x3000000000000000000000000000000000000000' as const;
const collection = '0x1000000000000000000000000000000000000000' as const;
const rareMinter = '0x2000000000000000000000000000000000000000' as const;

describe('release configure planning', () => {
  it('plans ETH release defaults from plain inputs', () => {
    expect(
      planReleaseConfigure(
        {
          contract: collection,
          price: '0.5',
          maxMints: '3',
        },
        {
          accountAddress,
          currencyDecimals: null,
          nowSeconds: 1_700_000_000n,
        },
      ),
    ).toEqual({
      contract: collection,
      currencyAddress: ETH_ADDRESS,
      price: parseEther('0.5'),
      startTime: 1_700_000_000n,
      maxMints: 3n,
      splitRecipients: [accountAddress],
      splitRatios: [100],
    });
  });

  it('plans ERC20 releases with explicit decimals, start time, and splits', () => {
    expect(
      planReleaseConfigure(
        {
          contract: collection,
          currency: erc20Currency,
          price: '1.25',
          startTime: '2024-01-02T00:00:00.000Z',
          maxMints: 10,
          splitAddresses: [accountAddress, recipientAddress],
          splitRatios: [70, 30],
        },
        {
          accountAddress,
          currencyDecimals: 6,
          nowSeconds: 1_700_000_000n,
        },
      ),
    ).toMatchObject({
      currencyAddress: erc20Currency,
      price: parseUnits('1.25', 6),
      startTime: 1_704_153_600n,
      maxMints: 10n,
      splitRecipients: [accountAddress, recipientAddress],
      splitRatios: [70, 30],
    });
  });

  it('rejects invalid release business inputs before shell writes', () => {
    expect(
      planReleaseConfigure(
        { contract: collection, price: '1', maxMints: 0 },
        { accountAddress, currencyDecimals: null, nowSeconds: 1n },
      ).maxMints,
    ).toBe(0n);
    expect(() =>
      planReleaseConfigure(
        { contract: collection, price: '1', maxMints: -1 },
        { accountAddress, currencyDecimals: null, nowSeconds: 1n },
      ),
    ).toThrow('maxMints must be an integer between 0 and 100.');
    expect(() =>
      planReleaseConfigure(
        { contract: collection, price: '1', maxMints: 101 },
        { accountAddress, currencyDecimals: null, nowSeconds: 1n },
      ),
    ).toThrow('maxMints must be an integer between 0 and 100.');
    expect(() => normalizeReleaseStartTime('-1', 1n)).toThrow(
      'startTime must be greater than or equal to 0.',
    );
    expect(() =>
      resolveReleaseSplits({
        splitAddresses: [accountAddress],
        splitRatios: [50],
        defaultRecipient: accountAddress,
      }),
    ).toThrow('splitRatios must sum to 100 (got 50).');
    expect(() =>
      normalizeReleasePrice({
        currencyAddress: erc20Currency,
        amount: '1',
        currencyDecimals: null,
      }),
    ).toThrow('currencyDecimals is required to normalize ERC20 price amounts.');
  });

  it('checks collection ownership as pure release validation', () => {
    expect(() =>
      assertReleaseContractOwner({
        contract: collection,
        accountAddress,
        owner: recipientAddress,
      }),
    ).toThrow(`Connected wallet ${accountAddress} is not the owner of collection ${collection}.`);

    expect(() =>
      assertReleaseContractOwner({
        contract: collection,
        accountAddress,
        owner: accountAddress,
      }),
    ).not.toThrow();
  });
});

describe('release allowlist artifacts', () => {
  const walletA = '0x0000000000000000000000000000000000000003' as const;
  const walletB = '0x0000000000000000000000000000000000000004' as const;
  const walletC = '0x0000000000000000000000000000000000000005' as const;

  it('builds reusable Merkle proof artifacts from CSV wallets', () => {
    const artifact = buildReleaseAllowlistArtifactFromInput(
      [
        'wallet,notes',
        `${walletC},third`,
        `${walletA},first`,
        `${walletB},second`,
      ].join('\n'),
      'csv',
    );

    expect(artifact).toMatchObject({
      kind: 'rare-release-allowlist-v1',
      version: 1,
      leafEncoding: 'keccak256(address)',
      tree: 'sorted-addresses-sort-pairs',
      wallets: [
        expect.objectContaining({ address: walletA }),
        expect.objectContaining({ address: walletB }),
        expect.objectContaining({ address: walletC }),
      ],
    });
    expect(artifact.root).toMatch(/^0x[0-9a-f]{64}$/);

    for (const wallet of artifact.wallets) {
      expect(verifyReleaseAllowlistProof({
        root: artifact.root,
        address: wallet.address,
        proof: wallet.proof,
      })).toBe(true);
    }
  });

  it('builds artifacts from JSON wallet arrays and returns wallet proofs', () => {
    const artifact = buildReleaseAllowlistArtifactFromInput(
      JSON.stringify({
        wallets: [
          { wallet: walletB },
          { address: walletA },
        ],
      }),
      'json',
    );
    const proof = getReleaseAllowlistProof({ artifact, address: walletB });

    expect(artifact.wallets).toHaveLength(2);
    expect(proof?.address).toBe(walletB);
    expect(proof?.proof).toHaveLength(1);
    expect(parseReleaseAllowlistArtifact(JSON.parse(JSON.stringify(artifact)))).toEqual(artifact);
  });

  it('rejects invalid, duplicate, and malformed allowlist inputs with clear errors', () => {
    expect(() => parseReleaseAllowlistCsv('wallet\nnot-an-address')).toThrow(
      'Invalid allowlist address at CSV row 2: "not-an-address".',
    );
    expect(() => parseReleaseAllowlistCsv(`wallet\n${walletA}\n${walletA}`)).toThrow(
      `Duplicate allowlist address at CSV row 3: "${walletA}" duplicates CSV row 2.`,
    );
    expect(() => parseReleaseAllowlistCsv('"unterminated')).toThrow(
      'Malformed CSV allowlist at row 1: unterminated quoted field.',
    );
    expect(() => buildReleaseAllowlistArtifact([])).toThrow(
      'Allowlist must contain at least one wallet address.',
    );
  });
});

describe('release allowlist and limit planning', () => {
  it('plans allowlist config from an artifact root and parses ISO end timestamps', () => {
    const artifact = buildReleaseAllowlistArtifact([accountAddress, recipientAddress]);

    expect(
      planReleaseAllowlistConfig({
        contract: collection,
        artifact,
        endTime: '2026-01-01T00:00:00.000Z',
      }),
    ).toEqual({
      contract: collection,
      root: artifact.root,
      endTimestamp: 1_767_225_600n,
    });
  });

  it('plans non-negative mint and transaction limits', () => {
    expect(planReleaseLimitConfig({ contract: collection, limit: '0' })).toEqual({
      contract: collection,
      limit: 0n,
    });
    expect(planReleaseLimitConfig({ contract: collection, limit: 3 })).toEqual({
      contract: collection,
      limit: 3n,
    });
    expect(() => planReleaseLimitConfig({ contract: collection, limit: '-1' })).toThrow(
      'limit must be greater than or equal to 0.',
    );
  });

});

describe('release config result shaping and verification', () => {
  it('shapes allowlist and limit config reads in the core', () => {
    expect(shapeReleaseAllowlistConfig({
      rareMinter,
      contract: collection,
      allowlist: { root: `0x${'11'.repeat(32)}`, endTimestamp: 2_000n },
      nowSeconds: 1_000n,
    })).toEqual({
      rareMinter,
      contract: collection,
      root: `0x${'11'.repeat(32)}`,
      endTimestamp: 2_000n,
      active: true,
      now: 1_000n,
    });

    expect(shapeReleaseLimitConfig({
      rareMinter,
      contract: collection,
      limit: 0n,
    })).toEqual({
      rareMinter,
      contract: collection,
      limit: 0n,
      enabled: false,
    });

  });

  it('verifies RareMinter config readbacks without SDK shell logic', () => {
    const allowlist = { root: `0x${'22'.repeat(32)}` as const, endTimestamp: 123n };
    expect(() => assertReleaseAllowlistConfigMatches(allowlist, allowlist)).not.toThrow();
    expect(() => assertReleaseAllowlistConfigMatches(allowlist, {
      ...allowlist,
      endTimestamp: 124n,
    })).toThrow('RareMinter allowlist verification failed.');

    expect(() => assertReleaseLimitMatches('mint limit', 2n, 2n)).not.toThrow();
    expect(() => assertReleaseLimitMatches('mint limit', 2n, 1n)).toThrow(
      'RareMinter mint limit verification failed.',
    );

  });
});

describe('release status shaping', () => {
  it('classifies a configured started release as currently mintable', () => {
    expect(
      shapeReleaseStatus({
        rareMinter,
        contract: collection,
        directSale: {
          seller: accountAddress,
          currencyAddress: ETH_ADDRESS,
          price: parseEther('1'),
          startTime: 900n,
          maxMints: 5n,
          splitRecipients: [accountAddress],
          splitRatios: [100],
        },
        allowlist: { root: ZERO_BYTES32, endTimestamp: 0n },
        mintLimit: 0n,
        txLimit: 0n,
        account: null,
        accountMints: null,
        accountTxs: null,
        totalSupply: 5n,
        maxSupply: 10n,
        currencyDecimals: 18,
        nowSeconds: 1_000n,
      }),
    ).toMatchObject({
      configured: true,
      started: true,
      allowlistActive: false,
      remainingSupply: 5n,
      soldOut: false,
      currentlyMintable: true,
      now: 1_000n,
    });
  });

  it('treats zero collection max supply as sold out, not uncapped', () => {
    const status = shapeReleaseStatus({
      rareMinter,
      contract: collection,
      directSale: {
        seller: accountAddress,
        currencyAddress: ETH_ADDRESS,
        price: parseEther('1'),
        startTime: 900n,
        maxMints: 0n,
        splitRecipients: [accountAddress],
        splitRatios: [100],
      },
      allowlist: { root: ZERO_BYTES32, endTimestamp: 0n },
      mintLimit: 0n,
      txLimit: 0n,
      account: accountAddress,
      accountMints: 0n,
      accountTxs: 0n,
      totalSupply: 0n,
      maxSupply: 0n,
      currencyDecimals: 18,
      nowSeconds: 1_000n,
    });

    expect(status).toMatchObject({
      remainingSupply: 0n,
      soldOut: true,
      currentlyMintable: false,
    });
    expect(() => preflightReleaseDirectSaleMint({
      status,
      plan: planReleaseDirectSaleMint({ contract: collection, quantity: 1 }),
      buyer: accountAddress,
      nowSeconds: 1_000n,
    })).toThrow('Release collection is sold out.');
  });

  it('uses limits and unconfigured seller state to mark releases unavailable', () => {
    const limited = shapeReleaseStatus({
      rareMinter,
      contract: collection,
      directSale: {
        seller: accountAddress,
        currencyAddress: ETH_ADDRESS,
        price: parseEther('1'),
        startTime: 900n,
        maxMints: 5n,
        splitRecipients: [accountAddress],
        splitRatios: [100],
      },
      allowlist: { root: `0x${'11'.repeat(32)}`, endTimestamp: 1_500n },
      mintLimit: 2n,
      txLimit: 0n,
      account: recipientAddress,
      accountMints: 2n,
      accountTxs: 0n,
      totalSupply: 10n,
      maxSupply: 10n,
      currencyDecimals: 18,
      nowSeconds: 1_000n,
    });

    expect(limited).toMatchObject({
      allowlistActive: true,
      requiresAllowlist: true,
      remainingSupply: 0n,
      soldOut: true,
      currentlyMintable: false,
    });

    const unconfigured = shapeReleaseStatus({
      rareMinter,
      contract: collection,
      directSale: {
        seller: ETH_ADDRESS,
        currencyAddress: ETH_ADDRESS,
        price: 0n,
        startTime: 0n,
        maxMints: 0n,
        splitRecipients: [],
        splitRatios: [],
      },
      allowlist: { root: ZERO_BYTES32, endTimestamp: 0n },
      mintLimit: 0n,
      txLimit: 0n,
      account: null,
      accountMints: null,
      accountTxs: null,
      totalSupply: null,
      maxSupply: null,
      currencyDecimals: 18,
      nowSeconds: 1_000n,
    });

    expect(unconfigured.configured).toBe(false);
    expect(unconfigured.currentlyMintable).toBe(false);
  });
});

describe('release direct sale mint planning', () => {
  it('plans direct sale mint inputs and validates uint8 quantity and proof entries', () => {
    const root = `0x${'11'.repeat(32)}` as const;

    expect(planReleaseDirectSaleMint({
      contract: collection,
      quantity: '2',
      price: '0.5',
      proof: [root],
    })).toEqual({
      contract: collection,
      quantity: 2,
      currency: undefined,
      price: '0.5',
      proof: [root],
      proofProvided: true,
      recipient: undefined,
      autoApprove: true,
    });

    expect(() => planReleaseDirectSaleMint({
      contract: collection,
      quantity: 256,
    })).toThrow('quantity must be less than or equal to 255.');
    expect(() => planReleaseDirectSaleMint({
      contract: collection,
      proof: ['0x1234'],
    })).toThrow('proof[0] must be a 32-byte hex string.');
  });

  it('preflights direct sale mint limits, supply, price, and allowlist proofs', () => {
    const artifact = buildReleaseAllowlistArtifact([recipientAddress, accountAddress]);
    const walletProof = getReleaseAllowlistProof({ artifact, address: accountAddress });
    if (walletProof === null) {
      throw new Error('expected allowlist proof for accountAddress');
    }

    const status = shapeReleaseStatus({
      rareMinter,
      contract: collection,
      directSale: {
        seller: recipientAddress,
        currencyAddress: ETH_ADDRESS,
        price: 10n,
        startTime: 90n,
        maxMints: 2n,
        splitRecipients: [recipientAddress],
        splitRatios: [100],
      },
      allowlist: { root: artifact.root, endTimestamp: 200n },
      mintLimit: 2n,
      txLimit: 1n,
      account: accountAddress,
      accountMints: 1n,
      accountTxs: 0n,
      totalSupply: 1n,
      maxSupply: 3n,
      currencyDecimals: 18,
      nowSeconds: 100n,
    });

    expect(preflightReleaseDirectSaleMint({
      status,
      plan: planReleaseDirectSaleMint({
        contract: collection,
        quantity: 1,
        proof: walletProof.proof,
      }),
      buyer: accountAddress,
      nowSeconds: 100n,
    })).toEqual({
      contract: collection,
      buyer: accountAddress,
      recipient: accountAddress,
      quantity: 1,
      currency: ETH_ADDRESS,
      price: 10n,
      totalPrice: 10n,
      proof: walletProof.proof,
      allowlistRequired: true,
    });
  });

  it('preflights singleton allowlists with an empty Merkle proof', () => {
    const artifact = buildReleaseAllowlistArtifact([accountAddress]);
    const walletProof = getReleaseAllowlistProof({ artifact, address: accountAddress });
    if (walletProof === null) {
      throw new Error('expected allowlist proof for accountAddress');
    }
    expect(walletProof.proof).toEqual([]);

    const status = shapeReleaseStatus({
      rareMinter,
      contract: collection,
      directSale: {
        seller: recipientAddress,
        currencyAddress: ETH_ADDRESS,
        price: 10n,
        startTime: 90n,
        maxMints: 2n,
        splitRecipients: [recipientAddress],
        splitRatios: [100],
      },
      allowlist: { root: artifact.root, endTimestamp: 200n },
      mintLimit: 0n,
      txLimit: 0n,
      account: accountAddress,
      accountMints: 0n,
      accountTxs: 0n,
      totalSupply: 1n,
      maxSupply: 3n,
      currencyDecimals: 18,
      nowSeconds: 100n,
    });

    expect(preflightReleaseDirectSaleMint({
      status,
      plan: planReleaseDirectSaleMint({
        contract: collection,
        quantity: 1,
        proof: walletProof.proof,
      }),
      buyer: accountAddress,
      nowSeconds: 100n,
    })).toMatchObject({
      proof: [],
      allowlistRequired: true,
      buyer: accountAddress,
    });
  });

  it('rejects direct sale mints that fail contract preconditions', () => {
    const baseStatusInput = {
      rareMinter,
      contract: collection,
      directSale: {
        seller: recipientAddress,
        currencyAddress: ETH_ADDRESS,
        price: 10n,
        startTime: 90n,
        maxMints: 1n,
        splitRecipients: [recipientAddress],
        splitRatios: [100],
      },
      allowlist: { root: `0x${'11'.repeat(32)}`, endTimestamp: 200n },
      mintLimit: 0n,
      txLimit: 0n,
      account: accountAddress,
      accountMints: 0n,
      accountTxs: 0n,
      totalSupply: 2n,
      maxSupply: 2n,
      currencyDecimals: 18,
      nowSeconds: 100n,
    } as const;
    const status = shapeReleaseStatus(baseStatusInput);

    expect(() => preflightReleaseDirectSaleMint({
      status,
      plan: planReleaseDirectSaleMint({ contract: collection }),
      buyer: accountAddress,
      nowSeconds: 100n,
    })).toThrow('Release collection is sold out.');

    const availableStatus = shapeReleaseStatus({
      ...baseStatusInput,
      allowlist: { root: `0x${'11'.repeat(32)}`, endTimestamp: 200n },
      totalSupply: 0n,
      maxSupply: 2n,
    });

    expect(() => preflightReleaseDirectSaleMint({
      status: availableStatus,
      plan: planReleaseDirectSaleMint({ contract: collection }),
      buyer: accountAddress,
      nowSeconds: 100n,
    })).toThrow('Allowlist proof does not match the connected wallet and release root.');

    expect(() => preflightReleaseDirectSaleMint({
      status: shapeReleaseStatus({
        ...baseStatusInput,
        allowlist: { root: ZERO_BYTES32, endTimestamp: 0n },
        totalSupply: 0n,
        maxSupply: 2n,
      }),
      plan: planReleaseDirectSaleMint({
        contract: collection,
        recipient: recipientAddress,
      }),
      buyer: accountAddress,
      nowSeconds: 100n,
    })).toThrow('does not support a separate recipient');
  });

  it('shapes minted token ranges from MintDirectSale event arguments', () => {
    expect(shapeReleaseMintTokenRange(3n, 5n)).toEqual({
      tokenIdStart: 3n,
      tokenIdEnd: 5n,
      tokenIds: [3n, 4n, 5n],
    });
    expect(() => shapeReleaseMintTokenRange(5n, 3n)).toThrow('MintDirectSale event token range is invalid');
  });
});
