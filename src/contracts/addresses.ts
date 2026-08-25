import { getAddress, isAddress, isAddressEqual, zeroAddress, type Address, type Chain } from 'viem';
import { sepolia, mainnet, base, baseSepolia } from 'viem/chains';

export const supportedChains = [
  'mainnet',
  'sepolia',
  'base',
  'base-sepolia',
] as const;

export type SupportedChain = (typeof supportedChains)[number];

export const viemChains: Record<SupportedChain, Chain> = {
  mainnet,
  sepolia,
  base,
  'base-sepolia': baseSepolia,
};

export const chainIds: Record<SupportedChain, number> = {
  mainnet: 1,
  sepolia: 11155111,
  base: 8453,
  'base-sepolia': 84532,
};

export const defaultRpcUrls: Partial<Record<SupportedChain, string>> = {
  mainnet: 'https://ethereum-rpc.publicnode.com',
  sepolia: 'https://rpc.sepolia.org',
  base: 'https://mainnet.base.org',
  'base-sepolia': 'https://sepolia.base.org',
};

export type CanonicalV4Pool = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
  poolId?: `0x${string}`;
}

export type ContractAddresses = {
  factory: Address;
  auction: Address;
  rareBridge?: Address;
  sovereignFactory?: Address;
  lazySovereignFactory?: Address;
  rareMinter?: Address;
  lazyBatchMintFactory?: Address;
  batchListing?: Address;
  batchOfferCreator?: Address;
  batchAuctionHouse?: Address;
  marketplaceSettings?: Address;
  erc20ApprovalManager?: Address;
  erc721ApprovalManager?: Address;
  erc1155Marketplace?: Address;
  erc1155ContractFactory?: Address;
  erc1155ApprovalManager?: Address;
  liquidFactory?: Address;
  swapRouter?: Address;
  v4Quoter?: Address;
  cart?: Address;
  cartLens?: Address;
};

export type CanonicalV4Pools = {
  rareEthPool?: CanonicalV4Pool;
  usdcEthPool?: CanonicalV4Pool;
};

export const contractAddresses: Partial<Record<SupportedChain, ContractAddresses>> = {
  sepolia: {
    factory: getAddress('0x3c7526a0975156299ceef369b8ff3c01cc670523'),
    auction: getAddress('0xC8Edc7049b233641ad3723D6C60019D1c8771612'),
    rareBridge: getAddress('0xdC168291658f6C5F1D0b33E573c4d289DCA9dD08'),
    sovereignFactory: getAddress('0x46B2850ba7787734F648A6848b5eDE0815C1F8Bf'),
    lazySovereignFactory: getAddress('0xc5B8Ad9003673a23d005A6448C74d8955a1a38fA'),
    rareMinter: getAddress('0xd28Dc0B89104d7BBd902F338a0193fF063617ccE'),
    lazyBatchMintFactory: getAddress('0xE5efBA88D556aDA98124654fE505465b8d494858'),
    batchListing: getAddress('0xF2bE72d4343beD375Cb6d0E799a3c003163860e0'),
    batchOfferCreator: getAddress('0x371cca54ef859bb0c7b910581a528ee47773fd56'),
    batchAuctionHouse: getAddress('0x293AE7701A7830B1d38A7608EdF86A106d9E2645'),
    marketplaceSettings: getAddress('0x972dEe8fa339ad2D9c6cbDA31b67f98Fac242d13'),
    erc20ApprovalManager: getAddress('0x4619eB29e84392CE91C27FC936A5c94d1D14b93f'),
    erc721ApprovalManager: getAddress('0x5fa0a461d3a2Ea3bFDf03e8BD37CAbB4ae84205E'),
    erc1155Marketplace: getAddress('0xb26DE57230913a44F37AcE78F5b7eB2Efec474eE'),
    erc1155ContractFactory: getAddress('0xF8FF48ca6022138C58e2eDD680a02d7Cd394B957'),
    erc1155ApprovalManager: getAddress('0xcD26069837682aeD8Ba20852AD17b8f64a860906'),
    liquidFactory: getAddress('0xb1777091C953fa2aC1fD67f2b3e2f61343F5Ce5e'),
    swapRouter: getAddress('0x429c3Ee66E7f6CDA12C5BadE4104aF3277aA2305'),
    v4Quoter: getAddress('0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227'),
    cart: getAddress('0x1EBF35b3A76caEf60a009d2786A66A91D42A38Bc'),
    cartLens: getAddress('0x27dE8e7Ef6d8a24451F512eAa0c2D73A8dB90993'),
  },
  mainnet: {
    factory: getAddress('0xAe8E375a268Ed6442bEaC66C6254d6De5AeD4aB1'),
    auction: getAddress('0x6D7c44773C52D396F43c2D511B81aa168E9a7a42'),
    rareBridge: getAddress('0x88135dd0e7a8a2e42272dda89849a997ce2e83f7'),
    sovereignFactory: getAddress('0xe980ec62378529d95ba446433f4deb6324129c59'),
    lazySovereignFactory: getAddress('0xba798BD606d86D207ca2751510173532899117a1'),
    rareMinter: getAddress('0x5fa112EFeD8297bec0010b312208d223E0cE891E'),
    lazyBatchMintFactory: getAddress('0x40F9E4b420D5A8fF5aED32B5F72A37013c0739B6'),
    batchListing: getAddress('0x6a190885A806D39A0A8C348bfA1ac762D72E608d'),
    batchOfferCreator: getAddress('0xe15cf80b25272ade261532efdb7912f9104851d4'),
    batchAuctionHouse: getAddress('0x71742c7196f1c334C4c038ce6dcDcEE98097F9Da'),
    marketplaceSettings: getAddress('0x61DBF87164d33FD3695256DC8Ba74D3B1d304170'),
    erc20ApprovalManager: getAddress('0xa837a7eAff154Ab837617Cf7250648D3Ec0A4436'),
    erc721ApprovalManager: getAddress('0x4bb0Deea6d1A30C601338aAB776d394C2AE5c0F8'),
    erc1155Marketplace: getAddress('0x0015F7659d86cd7F1049C039abE72AEd702De678'),
    erc1155ContractFactory: getAddress('0x47d692D21Ee7DAb224Ce5587cE55fFA6A9563A93'),
    erc1155ApprovalManager: getAddress('0x6c88e19dB0d11939e283F3f876C6Dc3Cadf16a2F'),
    liquidFactory: getAddress('0x25f993C222fE5e891128a782A5168f1C78629540'),
    swapRouter: getAddress('0xEBd58EdA8408d9EA409f2c2bE8898BD9738f3583'),
    v4Quoter: getAddress('0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203'),
  },
  base: {
    factory: getAddress('0xf776204233bfb52ba0ddff24810cbdbf3dbf94dd'),
    auction: getAddress('0x51c36ffb05e17ed80ee5c02fa83d7677c5613de2'),
    rareBridge: getAddress('0x3b41e21094611d152a08d3691a70837f1a077dae'),
    lazySovereignFactory: getAddress('0x61E161062ba4EC0556Df23E586bE8E13B435F7F1'),
    lazyBatchMintFactory: getAddress('0x787A1705E2c4B07A716299F8F1fAa8CaC48305cd'),
    rareMinter: getAddress('0xFb2bd8A5543c73D38BabA504520A48ff7ed6CF57'),
    batchListing: getAddress('0x36A66dF396877f6771D9f9981AD70B712ee523CF'),
    batchOfferCreator: getAddress('0xe52976E85393C344F01A3dDFbFDc2F68854427Cc'),
    batchAuctionHouse: getAddress('0xc033BBef0Af25Db7523FCe16BaB1C39df0bF2Ae3'),
    marketplaceSettings: getAddress('0x1Ca04105730EF2bBE93040Feb20aCc668292F69D'),
    erc20ApprovalManager: getAddress('0x325B4CF6c521b3F67559731AEB63C71211bc724d'),
    erc721ApprovalManager: getAddress('0xDd867a8Eb1720185B3fdAD7F81Caed4E8132Be19'),
    erc1155Marketplace: getAddress('0xc0554C5e9483606A6A0Eff61CD9D4b3d413bAB7B'),
    erc1155ContractFactory: getAddress('0xCE472E1f8A519f92c1c0A32974309b82aE13c83C'),
    erc1155ApprovalManager: getAddress('0xE56Fc28cd3F748Ee7b427C55b68820bd688B0F68'),
    liquidFactory: getAddress('0x54016106A92895a38E54cA286216416750e517b1'),
    swapRouter: getAddress('0x6d078A410ee2AD08cACD8d22b486365433e98b7b'),
    v4Quoter: getAddress('0x0d5e0f971ed27fbff6c2837bf31316121532048d'),
  },
  'base-sepolia': {
    factory: getAddress('0x2b181ae0f1aea6fed75591b04991b1a3f9868d51'),
    auction: getAddress('0x1f0c946f0ee87acb268d50ede6c9b4d010af65d2'),
    rareBridge: getAddress('0xca491bb62A7730E97F500510132C47633DDD0229'),
    lazySovereignFactory: getAddress('0xCCC08b865805AdD648F6EC1f40114ba508353a9C'),
    lazyBatchMintFactory: getAddress('0xAF2302b45DdFF8243C62149217Eb529850A61A89'),
    rareMinter: getAddress('0xcb8bc09dc91fe8e8f43211537a709fc6053837f8'),
    batchListing: getAddress('0xAF5686eAdc6A575a0e9f455978ad712201744B3F'),
    batchOfferCreator: getAddress('0x20d2fa511fb1248a535600538816ac60477d3d09'),
    batchAuctionHouse: getAddress('0x2982275aCd95B97cCe02fdd8552E31D0a916C03c'),
    marketplaceSettings: getAddress('0xC83551914aB8784B4D779794cD74d12Ac4dF26Bc'),
    erc20ApprovalManager: getAddress('0x1104B5dA0fc1C08011a90557CA9b495c29D9BBaa'),
    erc721ApprovalManager: getAddress('0xaDf5459B9B6B3021aef027EC23E68C4011303F5B'),
    erc1155Marketplace: getAddress('0xc0D9CB069d7CfFb963A1527968bF28370A978BB6'),
    erc1155ContractFactory: getAddress('0x293AE7701A7830B1d38A7608EdF86A106d9E2645'),
    erc1155ApprovalManager: getAddress('0xDCEA787A109b2627a895EEb49FCe2D1dA63aA8E4'),
    liquidFactory: getAddress('0x912ecC55445d87149d09d83426D0aC41379bB643'),
    swapRouter: getAddress('0x92438008608949E2C7eCef34c474792bAFe8a971'),
    v4Quoter: getAddress('0x4a6513c898fe1b2d0e78d3b0e0a4a151589b1cba'),
  },
};

export const ccipChainSelectors: Record<SupportedChain, bigint> = {
  mainnet: 5009297550715157269n,
  sepolia: 16015286601757825753n,
  base: 15971525489660198786n,
  'base-sepolia': 10344971235874465080n,
};

export const canonicalV4Pools: Partial<Record<SupportedChain, CanonicalV4Pools>> = {
  sepolia: {
    rareEthPool: {
      currency0: zeroAddress,
      currency1: getAddress('0x197FaeF3f59eC80113e773Bb6206a17d183F97CB'),
      fee: 3000,
      tickSpacing: 60,
      hooks: zeroAddress,
      poolId: '0x781d2707a6eb9cd3bdbea356a0ba90f9c5ef274927f5e72b0060bba5abd94f03',
    },
    usdcEthPool: {
      currency0: zeroAddress,
      currency1: getAddress('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'),
      fee: 3000,
      tickSpacing: 60,
      hooks: zeroAddress,
      poolId: '0x3390c733d8252e864d4ce769398dd3fb8680d1f626719e8d7736d062665f0987',
    },
  },
  mainnet: {
    rareEthPool: {
      currency0: zeroAddress,
      currency1: getAddress('0xba5BDe662c17e2aDFF1075610382B9B691296350'),
      fee: 3000,
      tickSpacing: 60,
      hooks: zeroAddress,
      poolId: '0xc5e82ff54924a7232a3e91ca252d505f4e4417afa2b6a8507dfb691182cd0b16',
    },
    usdcEthPool: {
      currency0: zeroAddress,
      currency1: getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
      fee: 3000,
      tickSpacing: 60,
      hooks: zeroAddress,
      poolId: '0xdce6394339af00981949f5f3baf27e3610c76326a700af57e4b3e3ae4977f78d',
    },
  },
};

export const currencyNames = ['eth', 'rare', 'usdc'] as const;

export type CurrencyName = (typeof currencyNames)[number];
export type CurrencyInput = CurrencyName | Uppercase<CurrencyName> | Address;

export type CurrencyInfo = {
  name: CurrencyName;
  symbol: Uppercase<CurrencyName>;
  chain: SupportedChain;
  chainId: number;
  address: Address;
  decimals: number;
  isNative: boolean;
}

export type CustomCurrencyInfo = {
  name: null;
  symbol: null;
  chain: SupportedChain;
  chainId: number;
  address: Address;
  decimals: null;
  isNative: false;
}

export type ResolvedCurrency = CurrencyInfo | CustomCurrencyInfo;

export type CurrencyResolveResult =
  | { isValid: true; currency: ResolvedCurrency }
  | {
      isValid: false;
      error: 'unknown_currency' | 'unavailable_currency';
      errorMessage: string;
    };

export const ETH_ADDRESS: Address = zeroAddress;
export const PUBLIC_LISTING_TARGET: Address = zeroAddress;

const currencyAddresses: Record<CurrencyName, Partial<Record<SupportedChain, Address>>> = {
  eth: {
    mainnet: ETH_ADDRESS,
    sepolia: ETH_ADDRESS,
    base: ETH_ADDRESS,
    'base-sepolia': ETH_ADDRESS,
  },
  rare: {
    mainnet: getAddress('0xba5BDe662c17e2aDFF1075610382B9B691296350'),
    sepolia: getAddress('0x197FaeF3f59eC80113e773Bb6206a17d183F97CB'),
    base: getAddress('0x691077c8e8de54ea84efd454630439f99bd8c92f'),
    'base-sepolia': getAddress('0x8b21bC8571d11F7AdB705ad8F6f6BD1deb79cE01'),
  },
  usdc: {
    mainnet: getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
    sepolia: getAddress('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'),
    base: getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
    'base-sepolia': getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e'),
  },
};

const currencyDecimals: Record<CurrencyName, number> = {
  eth: 18,
  rare: 18,
  usdc: 6,
};

const currencySymbols: Record<CurrencyName, Uppercase<CurrencyName>> = {
  eth: 'ETH',
  rare: 'RARE',
  usdc: 'USDC',
};

function isCurrencyName(value: string): value is CurrencyName {
  return currencyNames.some((currencyName) => currencyName === value);
}

export function listCurrencies(chain: SupportedChain): CurrencyInfo[] {
  return currencyNames.flatMap((name) => {
    const address = currencyAddresses[name][chain];
    if (!address) return [];

    return [{
      name,
      symbol: currencySymbols[name],
      chain,
      chainId: chainIds[chain],
      address,
      decimals: currencyDecimals[name],
      isNative: name === 'eth',
    }];
  });
}

export function resolveCurrencyInfo(input: string, chain: SupportedChain): CurrencyResolveResult {
  const lower = input.toLowerCase();
  if (isCurrencyName(lower)) {
    const currency = listCurrencies(chain).find((entry) => entry.name === lower);
    if (currency === undefined) {
      return {
        isValid: false,
        error: 'unavailable_currency',
        errorMessage: `Currency "${lower}" is not available on "${chain}".`,
      };
    }
    return { isValid: true, currency };
  }

  if (isAddress(input)) {
    const address = getAddress(input);
    const known = listCurrencies(chain).find((entry) => isAddressEqual(entry.address, address));
    return {
      isValid: true,
      currency: known ?? {
        name: null,
        symbol: null,
        chain,
        chainId: chainIds[chain],
        address,
        decimals: null,
        isNative: false,
      },
    };
  }

  return {
    isValid: false,
    error: 'unknown_currency',
    errorMessage: `Unknown currency "${input}". Supported: ${currencyNames.join(', ')} or a 0x address.`,
  };
}

export function resolveCurrency(input: string, chain: SupportedChain): Address {
  const resolved = resolveCurrencyInfo(input, chain);
  if (!resolved.isValid) {
    throw new Error(resolved.errorMessage);
  }
  return resolved.currency.address;
}

export function getContractAddresses(chain: SupportedChain): ContractAddresses {
  const addresses = contractAddresses[chain];
  if (!addresses) {
    throw new Error(
      `RARE Protocol contracts are not deployed on "${chain}". Supported chains: ${Object.keys(contractAddresses).join(', ')}`
    );
  }
  return addresses;
}

export function getBatchListingAddress(chain: SupportedChain): Address {
  const addresses = getContractAddresses(chain);
  if (!addresses.batchListing) {
    const deployed = Object.entries(contractAddresses)
      .filter(([, set]) => set.batchListing !== undefined)
      .map(([name]) => name);
    throw new Error(
      `Batch listing marketplace is not deployed on "${chain}". Available on: ${deployed.join(', ')}`
    );
  }
  return addresses.batchListing;
}

export function getErc721ApprovalManagerAddress(chain: SupportedChain): Address {
  const addresses = getContractAddresses(chain);
  if (!addresses.erc721ApprovalManager) {
    const deployed = Object.entries(contractAddresses)
      .filter(([, set]) => set.erc721ApprovalManager !== undefined)
      .map(([name]) => name);
    throw new Error(
      `ERC721 approval manager is not deployed on "${chain}". Available on: ${deployed.join(', ')}`
    );
  }
  return addresses.erc721ApprovalManager;
}

export function getErc1155MarketplaceAddress(chain: SupportedChain): Address {
  const addresses = getContractAddresses(chain);
  if (!addresses.erc1155Marketplace) {
    const deployed = Object.entries(contractAddresses)
      .filter(([, set]) => set.erc1155Marketplace !== undefined)
      .map(([name]) => name);
    throw new Error(
      `ERC1155 marketplace is not deployed on "${chain}". Available on: ${deployed.join(', ')}`
    );
  }
  return addresses.erc1155Marketplace;
}

export function getErc1155ContractFactoryAddress(chain: SupportedChain): Address {
  const addresses = getContractAddresses(chain);
  if (!addresses.erc1155ContractFactory) {
    const deployed = Object.entries(contractAddresses)
      .filter(([, set]) => set.erc1155ContractFactory !== undefined)
      .map(([name]) => name);
    throw new Error(
      `ERC1155 contract factory is not deployed on "${chain}". Available on: ${deployed.join(', ')}`
    );
  }
  return addresses.erc1155ContractFactory;
}

export function getErc1155ApprovalManagerAddress(chain: SupportedChain): Address {
  const addresses = getContractAddresses(chain);
  if (!addresses.erc1155ApprovalManager) {
    const deployed = Object.entries(contractAddresses)
      .filter(([, set]) => set.erc1155ApprovalManager !== undefined)
      .map(([name]) => name);
    throw new Error(
      `ERC1155 approval manager is not deployed on "${chain}". Available on: ${deployed.join(', ')}`
    );
  }
  return addresses.erc1155ApprovalManager;
}

export function getCanonicalV4Pools(chain: SupportedChain): CanonicalV4Pools {
  const pools = canonicalV4Pools[chain];
  if (!pools) {
    throw new Error(
      `Canonical V4 pools are not configured for "${chain}". Supported chains: ${Object.keys(canonicalV4Pools).join(', ')}`
    );
  }
  return pools;
}

export function getRareMinterAddress(chain: SupportedChain): Address {
  const rareMinter = getContractAddresses(chain).rareMinter;
  if (!rareMinter) {
    throw new Error(
      `RareMinter is not configured on "${chain}". Supported RareMinter chains: mainnet, sepolia, base, base-sepolia.`
    );
  }
  return rareMinter;
}

export function getRareBridgeAddress(chain: SupportedChain): Address {
  const address = getContractAddresses(chain).rareBridge;
  if (!address) {
    throw new Error(`RareBridge is not configured on "${chain}". Supported RareBridge chains: mainnet, sepolia, base, base-sepolia.`);
  }
  return address;
}

export function getCcipChainSelector(chain: SupportedChain): bigint {
  return ccipChainSelectors[chain];
}

export function isSupportedChain(value: string): value is SupportedChain {
  return supportedChains.some((chain) => chain === value);
}

export function getLiquidFactoryAddress(chain: SupportedChain): Address {
  const address = getContractAddresses(chain).liquidFactory;
  if (!address) {
    throw new Error(`Liquid Editions factory is not configured for "${chain}". Supported chains: mainnet, sepolia, base, base-sepolia`);
  }
  return address;
}

export function getSwapRouterAddress(chain: SupportedChain): Address {
  const address = getContractAddresses(chain).swapRouter;
  if (!address) {
    throw new Error(`Liquid router is not configured for "${chain}". Supported chains: mainnet, sepolia, base, base-sepolia`);
  }
  return address;
}

export function getV4QuoterAddress(chain: SupportedChain): Address {
  const address = getContractAddresses(chain).v4Quoter;
  if (!address) {
    throw new Error(`Uniswap V4 quoter is not configured for "${chain}". Supported chains: mainnet, sepolia, base, base-sepolia`);
  }
  return address;
}

export function getCartAddress(chain: SupportedChain): Address {
  return requireContractAddress(chain, 'cart');
}

export function getCartLensAddress(chain: SupportedChain): Address | undefined {
  return getContractAddresses(chain).cartLens;
}

export function getCanonicalRareEthPool(chain: SupportedChain): CanonicalV4Pool {
  const pool = getCanonicalV4Pools(chain).rareEthPool;
  if (!pool) {
    throw new Error(`Canonical RARE/ETH pool is not configured for "${chain}". Supported chains: mainnet, sepolia`);
  }
  return pool;
}

export function getCanonicalUsdcEthPool(chain: SupportedChain): CanonicalV4Pool {
  const pool = getCanonicalV4Pools(chain).usdcEthPool;
  if (!pool) {
    throw new Error(`Canonical USDC/ETH pool is not configured for "${chain}". Supported chains: mainnet, sepolia`);
  }
  return pool;
}

export function requireContractAddress(
  chain: SupportedChain,
  contractName: keyof ContractAddresses,
): Address {
  const address = getContractAddresses(chain)[contractName];
  if (!address) {
    throw new Error(`RARE Protocol ${contractName} contract is not configured on "${chain}".`);
  }
  return address;
}
