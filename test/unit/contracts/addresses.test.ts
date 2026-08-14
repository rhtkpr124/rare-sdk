import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import {
  chainIds,
  ETH_ADDRESS,
  getCanonicalRareEthPool,
  getCanonicalUsdcEthPool,
  getContractAddresses,
  getErc721ApprovalManagerAddress,
  getErc1155ApprovalManagerAddress,
  getErc1155ContractFactoryAddress,
  getErc1155MarketplaceAddress,
  getCcipChainSelector,
  getLiquidFactoryAddress,
  getRareBridgeAddress,
  getRareMinterAddress,
  getSwapRouterAddress,
  getV4QuoterAddress,
  isSupportedChain,
  listCurrencies,
  requireContractAddress,
  resolveCurrency,
  resolveCurrencyInfo,
} from '../../../src/contracts/addresses.js';

describe('chain and currency helpers', () => {
  it('recognizes supported chains and exposes chain IDs', () => {
    expect(isSupportedChain('sepolia')).toBe(true);
    expect(isSupportedChain('base-sepolia')).toBe(true);
    expect(isSupportedChain('unknown')).toBe(false);
    expect(chainIds.sepolia).toBe(11_155_111);
  });

  it('resolves deployed contract addresses for configured chains', () => {
    expect(getContractAddresses('sepolia')).toEqual({
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
    });
    expect(getRareMinterAddress('sepolia')).toBe('0xd28Dc0B89104d7BBd902F338a0193fF063617ccE');
    expect(getRareBridgeAddress('sepolia')).toBe('0xdC168291658f6C5F1D0b33E573c4d289DCA9dD08');
    expect(getCcipChainSelector('sepolia')).toBe(16015286601757825753n);
    expect(getContractAddresses('mainnet').liquidFactory).toBe('0x25f993C222fE5e891128a782A5168f1C78629540');
    expect(getContractAddresses('mainnet').erc1155Marketplace).toBe(
      '0x0015F7659d86cd7F1049C039abE72AEd702De678',
    );
    expect(getContractAddresses('mainnet').erc1155ContractFactory).toBe(
      '0x47d692D21Ee7DAb224Ce5587cE55fFA6A9563A93',
    );
    expect(getContractAddresses('mainnet').erc1155ApprovalManager).toBe(
      '0x6c88e19dB0d11939e283F3f876C6Dc3Cadf16a2F',
    );
    expect(getContractAddresses('base')).toMatchObject({
      erc1155Marketplace: getAddress('0xc0554C5e9483606A6A0Eff61CD9D4b3d413bAB7B'),
      erc1155ContractFactory: getAddress('0xCE472E1f8A519f92c1c0A32974309b82aE13c83C'),
      erc1155ApprovalManager: getAddress('0xE56Fc28cd3F748Ee7b427C55b68820bd688B0F68'),
      liquidFactory: getAddress('0x54016106A92895a38E54cA286216416750e517b1'),
      swapRouter: getAddress('0x6d078A410ee2AD08cACD8d22b486365433e98b7b'),
      v4Quoter: getAddress('0x0d5e0f971ed27fbff6c2837bf31316121532048d'),
    });
    expect(getLiquidFactoryAddress('base')).toBe('0x54016106A92895a38E54cA286216416750e517b1');
    expect(getSwapRouterAddress('base')).toBe('0x6d078A410ee2AD08cACD8d22b486365433e98b7b');
    expect(getV4QuoterAddress('base')).toBe(getAddress('0x0d5e0f971ed27fbff6c2837bf31316121532048d'));
    expect(getContractAddresses('base-sepolia')).toMatchObject({
      erc1155Marketplace: getAddress('0xc0D9CB069d7CfFb963A1527968bF28370A978BB6'),
      erc1155ContractFactory: getAddress('0x293AE7701A7830B1d38A7608EdF86A106d9E2645'),
      erc1155ApprovalManager: getAddress('0xDCEA787A109b2627a895EEb49FCe2D1dA63aA8E4'),
      liquidFactory: getAddress('0x912ecC55445d87149d09d83426D0aC41379bB643'),
      swapRouter: getAddress('0x92438008608949E2C7eCef34c474792bAFe8a971'),
      v4Quoter: getAddress('0x4a6513c898fe1b2d0e78d3b0e0a4a151589b1cba'),
    });
    expect(getLiquidFactoryAddress('base-sepolia')).toBe(getAddress('0x912ecC55445d87149d09d83426D0aC41379bB643'));
    expect(getSwapRouterAddress('base-sepolia')).toBe(getAddress('0x92438008608949E2C7eCef34c474792bAFe8a971'));
    expect(getV4QuoterAddress('base-sepolia')).toBe(getAddress('0x4a6513c898fe1b2d0e78d3b0e0a4a151589b1cba'));
  });

  it('resolves canonical V4 pools separately from contract addresses', () => {
    expect(getCanonicalRareEthPool('sepolia')).toEqual({
      currency0: ETH_ADDRESS,
      currency1: '0x197FaeF3f59eC80113e773Bb6206a17d183F97CB',
      fee: 3000,
      tickSpacing: 60,
      hooks: ETH_ADDRESS,
      poolId: '0x781d2707a6eb9cd3bdbea356a0ba90f9c5ef274927f5e72b0060bba5abd94f03',
    });
    expect(getCanonicalUsdcEthPool('sepolia')).toMatchObject({
      currency1: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      fee: 3000,
      tickSpacing: 60,
    });
  });

  it('resolves the ERC721 approval manager for supported chains', () => {
    expect(getErc721ApprovalManagerAddress('sepolia')).toBe(
      '0x5fa0a461d3a2Ea3bFDf03e8BD37CAbB4ae84205E',
    );
  });

  it('resolves ERC1155 contract addresses for supported chains', () => {
    expect(getErc1155MarketplaceAddress('sepolia')).toBe('0xb26DE57230913a44F37AcE78F5b7eB2Efec474eE');
    expect(getErc1155ContractFactoryAddress('sepolia')).toBe('0xF8FF48ca6022138C58e2eDD680a02d7Cd394B957');
    expect(getErc1155ApprovalManagerAddress('sepolia')).toBe('0xcD26069837682aeD8Ba20852AD17b8f64a860906');
    expect(getErc1155MarketplaceAddress('base')).toBe('0xc0554C5e9483606A6A0Eff61CD9D4b3d413bAB7B');
    expect(getErc1155ContractFactoryAddress('base')).toBe('0xCE472E1f8A519f92c1c0A32974309b82aE13c83C');
    expect(getErc1155ApprovalManagerAddress('base')).toBe('0xE56Fc28cd3F748Ee7b427C55b68820bd688B0F68');
    expect(getErc1155MarketplaceAddress('base-sepolia')).toBe('0xc0D9CB069d7CfFb963A1527968bF28370A978BB6');
    expect(getErc1155ContractFactoryAddress('base-sepolia')).toBe('0x293AE7701A7830B1d38A7608EdF86A106d9E2645');
    expect(getErc1155ApprovalManagerAddress('base-sepolia')).toBe('0xDCEA787A109b2627a895EEb49FCe2D1dA63aA8E4');
    expect(getErc1155MarketplaceAddress('mainnet')).toBe('0x0015F7659d86cd7F1049C039abE72AEd702De678');
    expect(getErc1155ContractFactoryAddress('mainnet')).toBe('0x47d692D21Ee7DAb224Ce5587cE55fFA6A9563A93');
    expect(getErc1155ApprovalManagerAddress('mainnet')).toBe('0x6c88e19dB0d11939e283F3f876C6Dc3Cadf16a2F');
  });

  it('requires optional contract addresses only where configured', () => {
    expect(requireContractAddress('sepolia', 'sovereignFactory')).toBe('0x46B2850ba7787734F648A6848b5eDE0815C1F8Bf');
    expect(requireContractAddress('sepolia', 'lazySovereignFactory')).toBe('0xc5B8Ad9003673a23d005A6448C74d8955a1a38fA');
    expect(requireContractAddress('sepolia', 'rareMinter')).toBe('0xd28Dc0B89104d7BBd902F338a0193fF063617ccE');
    expect(requireContractAddress('sepolia', 'batchOfferCreator')).toBe(getAddress('0x371cca54ef859bb0c7b910581a528ee47773fd56'));
    expect(requireContractAddress('sepolia', 'batchAuctionHouse')).toBe('0x293AE7701A7830B1d38A7608EdF86A106d9E2645');
    expect(() => requireContractAddress('base', 'sovereignFactory')).toThrow(
      'RARE Protocol sovereignFactory contract is not configured on "base".',
    );
    expect(requireContractAddress('base', 'lazySovereignFactory')).toBe(getAddress('0x61E161062ba4EC0556Df23E586bE8E13B435F7F1'));
    expect(requireContractAddress('base', 'rareMinter')).toBe(getAddress('0xFb2bd8A5543c73D38BabA504520A48ff7ed6CF57'));
    expect(requireContractAddress('base', 'batchOfferCreator')).toBe(getAddress('0xe52976E85393C344F01A3dDFbFDc2F68854427Cc'));
    expect(requireContractAddress('base', 'batchAuctionHouse')).toBe(getAddress('0xc033BBef0Af25Db7523FCe16BaB1C39df0bF2Ae3'));
    expect(requireContractAddress('base-sepolia', 'batchAuctionHouse')).toBe(getAddress('0x2982275aCd95B97cCe02fdd8552E31D0a916C03c'));
    expect(getContractAddresses('base').factory).toBe(getAddress('0xf776204233bfb52ba0ddff24810cbdbf3dbf94dd'));
    expect(getContractAddresses('base-sepolia').factory).toBe(getAddress('0x2b181ae0f1aea6fed75591b04991b1a3f9868d51'));
  });

  it('resolves named currencies and custom ERC20 addresses', () => {
    expect(resolveCurrency('eth', 'sepolia')).toBe(ETH_ADDRESS);
    expect(resolveCurrency('USDC', 'sepolia')).toBe('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238');
    expect(resolveCurrency('0x1230000000000000000000000000000000000000', 'sepolia')).toBe(
      '0x1230000000000000000000000000000000000000',
    );
  });

  it('lists and resolves structured currency metadata', () => {
    expect(listCurrencies('sepolia')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'eth', symbol: 'ETH', address: ETH_ADDRESS, decimals: 18, isNative: true }),
      expect.objectContaining({ name: 'rare', symbol: 'RARE', decimals: 18, isNative: false }),
      expect.objectContaining({ name: 'usdc', symbol: 'USDC', decimals: 6, isNative: false }),
    ]));
    expect(resolveCurrencyInfo('usdc', 'sepolia')).toEqual({
      isValid: true,
      currency: expect.objectContaining({
        name: 'usdc',
        address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        decimals: 6,
      }),
    });
    expect(resolveCurrencyInfo('0x1230000000000000000000000000000000000000', 'sepolia')).toEqual({
      isValid: true,
      currency: expect.objectContaining({
        name: null,
        symbol: null,
        address: '0x1230000000000000000000000000000000000000',
        decimals: null,
      }),
    });
  });

  it('rejects unknown currency names', () => {
    expect(() => resolveCurrency('doge', 'sepolia')).toThrow(
      'Unknown currency "doge". Supported: eth, rare, usdc or a 0x address.',
    );
  });
});
