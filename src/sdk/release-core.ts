import {
  getAddress,
  isAddress,
  isAddressEqual,
  isHex,
  keccak256,
  type Address,
  type Hex,
} from 'viem';
import type {
  AmountInput,
  IntegerInput,
  TimestampInput,
} from './types/common.js';
import type {
  ReleaseAllowlistArtifact,
  ReleaseAllowlistConfig,
  ReleaseConfigureParams,
  ReleaseLimitConfig,
  ReleaseAllowlistInputFormat,
  ReleaseAllowlistWalletProof,
  ReleaseMintDirectSaleParams,
  ReleaseStatus,
} from './types/release.js';

type ResolvedCurrencyParam<T extends { currency?: unknown }> = Omit<T, 'currency'> & {
  currency?: Address;
};
import { ETH_ADDRESS } from '../contracts/addresses.js';
import { requireInput } from './validation-core.js';
import {
  toInteger,
  toNonNegativeInteger,
  toPositiveInteger,
} from './amounts-core.js';
import { planPayoutSplits } from './splits-core.js';

export const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as const;
export const RELEASE_ALLOWLIST_ARTIFACT_KIND = 'rare-release-allowlist-v1' as const;
const RELEASE_ALLOWLIST_LEAF_ENCODING = 'keccak256(address)' as const;
const RELEASE_ALLOWLIST_TREE = 'sorted-addresses-sort-pairs' as const;
const MAX_DIRECT_SALE_MINT_QUANTITY = 255n;

export type {
  ReleaseAllowlistArtifact,
  ReleaseAllowlistInputFormat,
  ReleaseAllowlistWalletProof,
} from './types/release.js';

export type ReleaseAllowlistConfigPlan = {
  contract: Address;
  root: Hex;
  endTimestamp: bigint;
};

export type ReleaseLimitConfigPlan = {
  contract: Address;
  limit: bigint;
};

export type RawDirectSaleConfig = {
  seller: Address;
  currencyAddress: Address;
  price: bigint;
  startTime: bigint;
  maxMints: bigint;
  splitRecipients: readonly Address[];
  splitRatios: readonly number[];
};

export type RawAllowlistConfig = {
  root: `0x${string}`;
  endTimestamp: bigint;
};

export type ReleaseConfigurePlan = {
  contract: Address;
  currencyAddress: Address;
  price: bigint;
  startTime: bigint;
  maxMints: bigint;
  splitRecipients: Address[];
  splitRatios: number[];
};

export type ReleaseDirectSaleMintPlan = {
  contract: Address;
  quantity: number;
  currency?: Address;
  price?: AmountInput;
  proof: Hex[];
  proofProvided: boolean;
  recipient?: Address;
  autoApprove: boolean;
};

export type ReleaseDirectSaleMintPreflight = {
  contract: Address;
  buyer: Address;
  recipient: Address;
  quantity: number;
  currency: Address;
  price: bigint;
  totalPrice: bigint;
  proof: Hex[];
  allowlistRequired: boolean;
};

export type ReleaseMintTokenRange = {
  tokenIdStart: bigint;
  tokenIdEnd: bigint;
  tokenIds: bigint[];
};

export function requireRareMinterAddress(address: Address | undefined): Address {
  if (!address) {
    throw new Error('RareMinter is not configured for this chain. Supported RareMinter chains: mainnet, sepolia, base, base-sepolia.');
  }
  return address;
}

export function assertReleaseContractOwner(opts: {
  contract: Address;
  accountAddress: Address;
  owner: Address;
}): void {
  const { contract, accountAddress, owner } = opts;
  if (!isAddressEqual(owner, accountAddress)) {
    throw new Error(
      `Connected wallet ${accountAddress} is not the owner of collection ${contract}. ` +
        `Contract owner is ${owner}.`,
    );
  }
}

export function normalizeReleaseTimestamp(
  value: TimestampInput | undefined,
  field: string,
  opts: { defaultValue?: bigint } = {},
): bigint {
  const timestamp = value === undefined
    ? requiredDefaultTimestamp(field, opts.defaultValue)
    : normalizeDefinedReleaseTimestamp(value, field);

  if (timestamp < 0n) {
    throw new Error(`${field} must be greater than or equal to 0.`);
  }
  return timestamp;
}

function requiredDefaultTimestamp(field: string, defaultValue: bigint | undefined): bigint {
  if (defaultValue === undefined) {
    throw new Error(`${field} is required.`);
  }
  return defaultValue;
}

function normalizeDefinedReleaseTimestamp(value: TimestampInput, field: string): bigint {
  if (value instanceof Date) {
    const milliseconds = value.getTime();
    if (!Number.isFinite(milliseconds)) {
      throw new Error(`${field} must be a valid date.`);
    }
    return BigInt(Math.floor(milliseconds / 1000));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?\d+$/.test(trimmed)) {
      return BigInt(trimmed);
    }
    const milliseconds = Date.parse(trimmed);
    if (Number.isNaN(milliseconds)) {
      throw new Error(`${field} must be a unix timestamp or ISO date string.`);
    }
    return BigInt(Math.floor(milliseconds / 1000));
  }

  return toInteger(value, field);
}

export function normalizeReleaseStartTime(
  value: TimestampInput | undefined,
  nowSeconds: bigint,
): bigint {
  return normalizeReleaseTimestamp(value, 'startTime', { defaultValue: nowSeconds });
}

export function normalizeReleasePrice(opts: {
  currencyAddress: Address;
  amount: AmountInput;
  currencyDecimals: number | null;
}): bigint {
  const { amount } = opts;
  if (amount < 0n) {
    throw new Error('price must be greater than or equal to 0.');
  }
  return amount;
}

export function resolveReleaseSplits(opts: {
  splitAddresses?: Address[];
  splitRatios?: number[];
  defaultRecipient: Address;
}): { splitRecipients: Address[]; splitRatios: number[] } {
  const splits = planPayoutSplits(opts.splitAddresses, opts.splitRatios, opts.defaultRecipient);
  return {
    splitRecipients: splits.addresses,
    splitRatios: splits.ratios,
  };
}

export function planReleaseConfigure(
  params: ResolvedCurrencyParam<ReleaseConfigureParams>,
  opts: {
    accountAddress: Address;
    nowSeconds: bigint;
    currencyDecimals: number | null;
  },
): ReleaseConfigurePlan {
  const currencyAddress = params.currency ?? ETH_ADDRESS;
  const price = normalizeReleasePrice({
    currencyAddress,
    amount: params.price,
    currencyDecimals: opts.currencyDecimals,
  });
  const startTime = normalizeReleaseStartTime(params.startTime, opts.nowSeconds);
  const maxMints = toInteger(
    requireInput(params.maxMints, 'maxMints'),
    'maxMints',
  );
  if (maxMints < 0n || maxMints > 100n) {
    throw new Error('maxMints must be an integer between 0 and 100.');
  }
  const { splitRecipients, splitRatios } = resolveReleaseSplits({
    splitAddresses: params.splitAddresses,
    splitRatios: params.splitRatios,
    defaultRecipient: opts.accountAddress,
  });

  return {
    contract: params.contract,
    currencyAddress,
    price,
    startTime,
    maxMints,
    splitRecipients,
    splitRatios,
  };
}

export function planReleaseAllowlistConfig(params: {
  contract: Address;
  root?: Hex;
  artifact?: ReleaseAllowlistArtifact;
  endTime: TimestampInput;
}): ReleaseAllowlistConfigPlan {
  const root = params.root ?? params.artifact?.root;
  if (!root) {
    throw new Error('Pass an allowlist artifact, or pass root as an override.');
  }

  const endTime = requireInput(params.endTime, 'endTime');
  return {
    contract: params.contract,
    root: normalizeBytes32(root, 'allowlist root'),
    endTimestamp: normalizeReleaseTimestamp(endTime, 'endTime'),
  };
}

export function planReleaseClearAllowlistConfig(params: {
  contract: Address;
}): ReleaseAllowlistConfigPlan {
  return {
    contract: params.contract,
    root: ZERO_BYTES32,
    endTimestamp: 0n,
  };
}

export function planReleaseLimitConfig(params: {
  contract: Address;
  limit: IntegerInput;
}): ReleaseLimitConfigPlan {
  const limit = requireInput(params.limit, 'limit');
  return {
    contract: params.contract,
    limit: toNonNegativeInteger(limit, 'limit'),
  };
}

export function planReleaseDirectSaleMint(params: ResolvedCurrencyParam<ReleaseMintDirectSaleParams>): ReleaseDirectSaleMintPlan {
  const quantity = toPositiveInteger(params.quantity ?? 1, 'quantity');
  if (quantity > MAX_DIRECT_SALE_MINT_QUANTITY) {
    throw new Error('quantity must be less than or equal to 255.');
  }

  return {
    contract: params.contract,
    quantity: Number(quantity),
    currency: params.currency,
    price: params.price,
    proof: normalizeReleaseAllowlistProof(params.proof ?? []),
    proofProvided: params.proof !== undefined,
    recipient: params.recipient,
    autoApprove: params.autoApprove ?? false,
  };
}

export function normalizeReleaseAllowlistProof(proof: readonly unknown[]): Hex[] {
  return proof.map((entry, index) => normalizeBytes32(entry, `proof[${index}]`));
}

export function buildReleaseAllowlistArtifactFromInput(
  input: string,
  format: ReleaseAllowlistInputFormat,
): ReleaseAllowlistArtifact {
  const wallets = format === 'csv'
    ? parseReleaseAllowlistCsv(input)
    : parseReleaseAllowlistJson(input);
  return buildReleaseAllowlistArtifact(wallets);
}

export function parseReleaseAllowlistArtifactJson(input: string): ReleaseAllowlistArtifact {
  const parsed = parseJsonUnknown(input, 'Malformed allowlist artifact JSON');
  return parseReleaseAllowlistArtifact(parsed);
}

export function parseReleaseAllowlistArtifact(input: unknown): ReleaseAllowlistArtifact {
  if (!isRecord(input)) {
    throw new Error('Allowlist artifact must be a JSON object.');
  }
  if (input.kind !== RELEASE_ALLOWLIST_ARTIFACT_KIND || input.version !== 1) {
    throw new Error(`Unsupported allowlist artifact. Expected kind "${RELEASE_ALLOWLIST_ARTIFACT_KIND}" version 1.`);
  }
  const root = normalizeBytes32(input.root, 'allowlist artifact root');
  if (!Array.isArray(input.wallets)) {
    throw new Error('Allowlist artifact must include a wallets array.');
  }

  const wallets = normalizeAllowlistRows(
    input.wallets.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new Error(`Invalid allowlist artifact wallet at index ${index}: expected an object.`);
      }
      return {
        value: entry.address,
        label: `artifact wallet ${index + 1}`,
      };
    }),
  );
  const artifact = buildReleaseAllowlistArtifact(wallets);
  if (!hexEquals(artifact.root, root)) {
    throw new Error(
      `Allowlist artifact root ${root} does not match the artifact wallets. Rebuild the artifact from the source allowlist.`,
    );
  }

  return artifact;
}

export function parseReleaseAllowlistCsv(input: string): Address[] {
  const rows = parseCsvRows(input).filter((row) =>
    row.fields.some((field) => field.trim().length > 0),
  );
  if (rows.length === 0) {
    throw new Error('CSV allowlist is empty.');
  }

  const firstRow = rows[0];
  if (firstRow === undefined) {
    throw new Error('CSV allowlist is empty.');
  }

  const headerColumn = findAllowlistAddressColumn(firstRow.fields);
  if (headerColumn === -1 && !isAddress(firstRow.fields[0]?.trim() ?? '')) {
    throw new Error('CSV allowlist must put wallet addresses in the first column or include an address/wallet header.');
  }
  const addressColumn = headerColumn === -1 ? 0 : headerColumn;
  const dataRows = headerColumn === -1 ? rows : rows.slice(1);

  if (dataRows.length === 0) {
    throw new Error('CSV allowlist does not contain any wallet rows.');
  }

  return normalizeAllowlistRows(dataRows.map((row) => ({
    value: row.fields[addressColumn],
    label: `CSV row ${row.number}`,
  })));
}

export function parseReleaseAllowlistJson(input: string): Address[] {
  const parsed = parseJsonUnknown(input, 'Malformed JSON allowlist');

  if (isRecord(parsed) && parsed.kind === RELEASE_ALLOWLIST_ARTIFACT_KIND) {
    return parseReleaseAllowlistArtifact(parsed).wallets.map((wallet) => wallet.address);
  }

  const entries = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.wallets)
      ? parsed.wallets
      : isRecord(parsed) && Array.isArray(parsed.addresses)
        ? parsed.addresses
        : null;

  if (!entries) {
    throw new Error(
      'JSON allowlist must be an array of wallet addresses, an array of objects with address/wallet, or an object with wallets/addresses.',
    );
  }

  return normalizeAllowlistRows(entries.map((entry, index) => ({
    value: getAddressFromJsonAllowlistEntry(entry, `JSON entry ${index + 1}`),
    label: `JSON entry ${index + 1}`,
  })));
}

export function buildReleaseAllowlistArtifact(wallets: readonly Address[]): ReleaseAllowlistArtifact {
  const addresses = normalizeAllowlistRows(wallets.map((wallet, index) => ({
    value: wallet,
    label: `wallet ${index + 1}`,
  })));
  if (addresses.length === 0) {
    throw new Error('Allowlist must contain at least one wallet address.');
  }

  const sortedAddresses = [...addresses].sort(compareAddress);
  const walletsWithLeaves = sortedAddresses.map((address) => ({
    address,
    leaf: hashAllowlistAddress(address),
  }));
  const leaves = walletsWithLeaves.map((wallet) => wallet.leaf);
  const layers = buildMerkleLayers(leaves);
  const root = getMerkleRoot(layers);

  return {
    kind: RELEASE_ALLOWLIST_ARTIFACT_KIND,
    version: 1,
    leafEncoding: RELEASE_ALLOWLIST_LEAF_ENCODING,
    tree: RELEASE_ALLOWLIST_TREE,
    root,
    wallets: walletsWithLeaves.map((wallet, index) => ({
      address: wallet.address,
      leaf: wallet.leaf,
      proof: getMerkleProof(layers, index),
    })),
  };
}

export function getReleaseAllowlistProof(opts: {
  artifact: ReleaseAllowlistArtifact;
  address: Address;
}): ReleaseAllowlistWalletProof | null {
  const address = getAddress(opts.address);
  return opts.artifact.wallets.find((entry) => addressesEqual(entry.address, address)) ?? null;
}

export function verifyReleaseAllowlistProof(opts: {
  root: Hex;
  address: Address;
  proof: readonly Hex[];
}): boolean {
  const root = normalizeBytes32(opts.root, 'allowlist root');
  const hash = opts.proof.reduce(
    (current, sibling) => hashMerklePair(current, normalizeBytes32(sibling, 'allowlist proof item')),
    hashAllowlistAddress(getAddress(opts.address)),
  );
  return hexEquals(hash, root);
}

export function preflightReleaseDirectSaleMint(params: {
  status: ReleaseStatus;
  plan: ReleaseDirectSaleMintPlan;
  buyer: Address;
  nowSeconds: bigint;
}): ReleaseDirectSaleMintPreflight {
  const { status, plan, buyer, nowSeconds } = params;
  const quantity = BigInt(plan.quantity);

  if (!isAddressEqual(status.contract, plan.contract)) {
    throw new Error(`Release status is for ${status.contract}, but mint plan is for ${plan.contract}.`);
  }
  if (!status.configured) {
    throw new Error('RareMinter direct sale is not configured for this contract.');
  }
  if (plan.recipient !== undefined && !isAddressEqual(plan.recipient, buyer)) {
    throw new Error('RareMinter direct sale mint does not support a separate recipient; it mints to the connected wallet.');
  }
  if (status.startTime > nowSeconds) {
    throw new Error(`RareMinter direct sale has not started. Starts at ${status.startTime}.`);
  }
  if (status.soldOut === true || (status.remainingSupply !== null && quantity > status.remainingSupply)) {
    throw new Error('Release collection is sold out.');
  }
  if (status.maxMints !== 0n && quantity > status.maxMints) {
    throw new Error(`quantity exceeds the release max mints per transaction (${status.maxMints}).`);
  }
  if (status.mintLimit > 0n) {
    const accountMints = requireReleaseAccountCounter(status.accountMints, 'mint');
    if (accountMints + quantity > status.mintLimit) {
      throw new Error(`quantity exceeds the remaining per-wallet mint limit (${status.mintLimit - accountMints}).`);
    }
  }
  if (status.txLimit > 0n) {
    const accountTxs = requireReleaseAccountCounter(status.accountTxs, 'transaction');
    if (accountTxs + 1n > status.txLimit) {
      throw new Error('buyer has reached the per-wallet transaction limit.');
    }
  }
  if (plan.currency !== undefined && !isAddressEqual(plan.currency, status.currencyAddress)) {
    throw new Error(`expected currency ${plan.currency} does not match configured currency ${status.currencyAddress}.`);
  }

  const price = plan.price === undefined
    ? status.price
    : normalizeReleasePrice({
        currencyAddress: status.currencyAddress,
        amount: plan.price,
        currencyDecimals: status.currencyDecimals,
      });
  if (price !== status.price) {
    throw new Error(`expected price ${price} does not match configured price ${status.price}.`);
  }

  const allowlistRequired = isReleaseAllowlistActive(status, nowSeconds);
  if (
    allowlistRequired &&
    !verifyReleaseAllowlistProof({
      root: status.allowlistRoot,
      address: buyer,
      proof: plan.proof,
    })
  ) {
    throw new Error('Allowlist proof does not match the connected wallet and release root.');
  }

  return {
    contract: plan.contract,
    buyer,
    recipient: buyer,
    quantity: plan.quantity,
    currency: status.currencyAddress,
    price,
    totalPrice: price * quantity,
    proof: plan.proof,
    allowlistRequired,
  };
}

export function isReleaseAllowlistActive(
  status: Pick<ReleaseStatus, 'allowlistRoot' | 'allowlistEndTimestamp'>,
  nowSeconds: bigint,
): boolean {
  return !hexEquals(status.allowlistRoot, ZERO_BYTES32) && status.allowlistEndTimestamp > nowSeconds;
}

export function shapeReleaseMintTokenRange(tokenIdStart: bigint, tokenIdEnd: bigint): ReleaseMintTokenRange {
  if (tokenIdEnd < tokenIdStart) {
    throw new Error(`MintDirectSale event token range is invalid: ${tokenIdStart} to ${tokenIdEnd}.`);
  }

  const count = tokenIdEnd - tokenIdStart + 1n;
  if (count > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('MintDirectSale event token range is too large to materialize.');
  }

  return {
    tokenIdStart,
    tokenIdEnd,
    tokenIds: Array.from({ length: Number(count) }, (_value, index) => tokenIdStart + BigInt(index)),
  };
}

export function shapeReleaseAllowlistConfig(opts: {
  rareMinter: Address;
  contract: Address;
  allowlist: RawAllowlistConfig;
  nowSeconds: bigint;
}): ReleaseAllowlistConfig {
  return {
    rareMinter: opts.rareMinter,
    contract: opts.contract,
    root: opts.allowlist.root,
    endTimestamp: opts.allowlist.endTimestamp,
    active: opts.allowlist.root !== ZERO_BYTES32 && opts.allowlist.endTimestamp > opts.nowSeconds,
    now: opts.nowSeconds,
  };
}

export function shapeReleaseLimitConfig(opts: {
  rareMinter: Address;
  contract: Address;
  limit: bigint;
}): ReleaseLimitConfig {
  return {
    rareMinter: opts.rareMinter,
    contract: opts.contract,
    limit: opts.limit,
    enabled: opts.limit > 0n,
  };
}

export function assertReleaseAllowlistConfigMatches(expected: {
  root: `0x${string}`;
  endTimestamp: bigint;
}, actual: RawAllowlistConfig): void {
  if (
    !hexEquals(actual.root, expected.root) ||
    actual.endTimestamp !== expected.endTimestamp
  ) {
    throw new Error(
      `RareMinter allowlist verification failed. Expected root ${expected.root} ending ${expected.endTimestamp}, ` +
        `read root ${actual.root} ending ${actual.endTimestamp}.`,
    );
  }
}

export function assertReleaseLimitMatches(field: string, expected: bigint, actual: bigint): void {
  if (actual !== expected) {
    throw new Error(`RareMinter ${field} verification failed. Expected ${expected}, read ${actual}.`);
  }
}

export function shapeReleaseStatus(opts: {
  rareMinter: Address;
  contract: Address;
  directSale: RawDirectSaleConfig;
  allowlist: RawAllowlistConfig;
  mintLimit: bigint;
  txLimit: bigint;
  account: Address | null;
  accountMints: bigint | null;
  accountTxs: bigint | null;
  totalSupply: bigint | null;
  maxSupply: bigint | null;
  currencyDecimals: number | null;
  nowSeconds: bigint;
}): ReleaseStatus {
  const configured = opts.directSale.seller !== ETH_ADDRESS;
  const started = configured && opts.directSale.startTime <= opts.nowSeconds;
  const allowlistActive = opts.allowlist.root !== ZERO_BYTES32 && opts.allowlist.endTimestamp > opts.nowSeconds;

  const remainingSupply =
    opts.totalSupply !== null && opts.maxSupply !== null
      ? opts.maxSupply > opts.totalSupply ? opts.maxSupply - opts.totalSupply : 0n
      : null;
  const soldOut =
    opts.totalSupply !== null && opts.maxSupply !== null
      ? opts.totalSupply >= opts.maxSupply
      : null;

  const accountMintLimitReached =
    opts.account !== null &&
    opts.accountMints !== null &&
    opts.mintLimit > 0n &&
    opts.accountMints >= opts.mintLimit;
  const accountTxLimitReached =
    opts.account !== null &&
    opts.accountTxs !== null &&
    opts.txLimit > 0n &&
    opts.accountTxs >= opts.txLimit;

  const currentlyMintable =
    configured &&
    started &&
    soldOut !== true &&
    !accountMintLimitReached &&
    !accountTxLimitReached;

  return {
    rareMinter: opts.rareMinter,
    contract: opts.contract,
    configured,
    seller: opts.directSale.seller,
    currencyAddress: opts.directSale.currencyAddress,
    currencyDecimals: opts.currencyDecimals,
    price: opts.directSale.price,
    startTime: opts.directSale.startTime,
    maxMints: opts.directSale.maxMints,
    splitRecipients: [...opts.directSale.splitRecipients],
    splitRatios: [...opts.directSale.splitRatios],
    allowlistRoot: opts.allowlist.root,
    allowlistEndTimestamp: opts.allowlist.endTimestamp,
    allowlistActive,
    requiresAllowlist: allowlistActive,
    mintLimit: opts.mintLimit,
    txLimit: opts.txLimit,
    account: opts.account,
    accountMints: opts.accountMints,
    accountTxs: opts.accountTxs,
    totalSupply: opts.totalSupply,
    maxSupply: opts.maxSupply,
    remainingSupply,
    soldOut,
    started,
    currentlyMintable,
    isEth: opts.directSale.currencyAddress === ETH_ADDRESS,
    now: opts.nowSeconds,
  };
}

function requireReleaseAccountCounter(value: bigint | null, label: string): bigint {
  if (value === null) {
    throw new Error(`Release ${label} limit preflight requires account usage reads.`);
  }
  return value;
}

function normalizeBytes32(value: unknown, field: string): Hex {
  if (typeof value !== 'string' || !isHex(value) || value.length !== 66) {
    throw new Error(`${field} must be a 32-byte hex string.`);
  }
  const normalized = value.toLocaleLowerCase();
  if (!isHex(normalized) || normalized.length !== 66) {
    throw new Error(`${field} must be a 32-byte hex string.`);
  }
  return normalized;
}

/* eslint-disable functional/no-let, functional/immutable-data */
function parseCsvRows(input: string): Array<{ fields: string[]; number: number }> {
  const rows: Array<{ fields: string[]; number: number }> = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let rowNumber = 1;

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (field.length > 0) {
        throw new Error(`Malformed CSV allowlist at row ${rowNumber}: unexpected quote.`);
      }
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n' || char === '\r') {
      row.push(field);
      rows.push({ fields: row, number: rowNumber });
      row = [];
      field = '';
      if (char === '\r' && input[i + 1] === '\n') {
        i++;
      }
      rowNumber++;
      continue;
    }

    field += char;
  }

  if (inQuotes) {
    throw new Error(`Malformed CSV allowlist at row ${rowNumber}: unterminated quoted field.`);
  }

  row.push(field);
  rows.push({ fields: row, number: rowNumber });
  return rows;
}
/* eslint-enable functional/no-let, functional/immutable-data */

function findAllowlistAddressColumn(fields: string[]): number {
  return fields.findIndex((field) => {
    const normalized = field.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalized === 'address' ||
      normalized === 'wallet' ||
      normalized === 'walletaddress';
  });
}

function normalizeAllowlistRows(rows: Array<{ value: unknown; label: string }>): Address[] {
  return rows.reduce<{ addresses: Address[]; seen: Array<{ address: Address; label: string }> }>((state, row) => {
    if (typeof row.value !== 'string') {
      throw new Error(`Invalid allowlist address at ${row.label}: expected a string.`);
    }

    const raw = row.value.trim();
    if (!isAddress(raw)) {
      throw new Error(`Invalid allowlist address at ${row.label}: "${raw}".`);
    }
    const address = getAddress(raw);
    const duplicate = state.seen.find((seen) => isAddressEqual(seen.address, address));
    if (duplicate !== undefined) {
      throw new Error(`Duplicate allowlist address at ${row.label}: "${address}" duplicates ${duplicate.label}.`);
    }
    return {
      addresses: [...state.addresses, address],
      seen: [...state.seen, { address, label: row.label }],
    };
  }, { addresses: [], seen: [] }).addresses;
}

function getAddressFromJsonAllowlistEntry(entry: unknown, label: string): unknown {
  if (typeof entry === 'string') {
    return entry;
  }
  if (!isRecord(entry)) {
    throw new Error(`Invalid allowlist ${label}: expected a string or object.`);
  }
  if ('address' in entry) return entry.address;
  if ('wallet' in entry) return entry.wallet;
  if ('walletAddress' in entry) return entry.walletAddress;
  if ('wallet_address' in entry) return entry.wallet_address;
  throw new Error(`Invalid allowlist ${label}: object must include address, wallet, walletAddress, or wallet_address.`);
}

function buildMerkleLayers(leaves: Hex[]): Hex[][] {
  if (leaves.length <= 1) {
    return [leaves];
  }
  const next = Array.from({ length: Math.ceil(leaves.length / 2) }, (_, pairIndex) => {
    const left = leaves[pairIndex * 2];
    if (left === undefined) {
      throw new Error('unreachable: missing Merkle leaf');
    }
    const right = leaves[pairIndex * 2 + 1];
    return right === undefined ? left : hashMerklePair(left, right);
  });
  return [leaves, ...buildMerkleLayers(next)];
}

function getMerkleProof(layers: Hex[][], leafIndex: number): Hex[] {
  return layers.slice(0, -1).reduce<{ proof: Hex[]; index: number }>((state, layer) => {
    const siblingIndex = state.index % 2 === 0 ? state.index + 1 : state.index - 1;
    const sibling = layer[siblingIndex];
    return {
      proof: sibling === undefined ? state.proof : [...state.proof, sibling],
      index: Math.floor(state.index / 2),
    };
  }, { proof: [], index: leafIndex }).proof;
}

function getMerkleRoot(layers: Hex[][]): Hex {
  const rootLayer = layers[layers.length - 1];
  const root = rootLayer?.[0];
  if (root === undefined) {
    throw new Error('unreachable: missing Merkle root');
  }
  return root;
}

function hashAllowlistAddress(address: Address): Hex {
  return keccak256(address);
}

function hashMerklePair(a: Hex, b: Hex): Hex {
  const [left, right] = compareHex(a, b) <= 0 ? [a, b] : [b, a];
  return keccak256(`0x${left.slice(2)}${right.slice(2)}`);
}

function compareAddress(a: Address, b: Address): number {
  return a.toLocaleLowerCase().localeCompare(b.toLocaleLowerCase());
}

function compareHex(a: Hex, b: Hex): number {
  return a.toLocaleLowerCase().localeCompare(b.toLocaleLowerCase());
}

function addressesEqual(a: Address, b: Address): boolean {
  return isAddressEqual(a, b);
}

function hexEquals(a: Hex, b: Hex): boolean {
  return a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonUnknown(input: string, label: string): unknown {
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new Error(`${label}: ${errorMessage(error)}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
