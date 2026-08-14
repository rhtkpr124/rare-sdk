import { describe, expect, it } from 'vitest';
import { toEventSelector, toFunctionSelector, type AbiEvent, type AbiFunction } from 'viem';
import { rareErc1155MarketplaceAbi } from '../../../src/contracts/abis/rare-erc1155-marketplace.js';

describe('ERC1155 marketplace ABI', () => {
  it('includes the cancel mint direct sales function and cancelled event', () => {
    const cancelMintDirectSales = rareErc1155MarketplaceAbi.find(
      (entry) => entry.type === 'function' && entry.name === 'cancelMintDirectSales',
    ) as AbiFunction | undefined;
    const mintDirectSaleCancelled = rareErc1155MarketplaceAbi.find(
      (entry) => entry.type === 'event' && entry.name === 'MintDirectSaleCancelled',
    ) as AbiEvent | undefined;

    if (!cancelMintDirectSales) {
      throw new Error('cancelMintDirectSales ABI entry is missing.');
    }
    if (!mintDirectSaleCancelled) {
      throw new Error('MintDirectSaleCancelled ABI entry is missing.');
    }

    expect(cancelMintDirectSales.inputs.map((input) => input.type)).toEqual(['address', 'uint256[]']);
    expect(toFunctionSelector(cancelMintDirectSales)).toBe('0x5e50c42e');
    expect(mintDirectSaleCancelled.inputs.map((input) => input.type)).toEqual(['address', 'uint256']);
    expect(toEventSelector(mintDirectSaleCancelled)).toBe(
      '0xda6836b3af7ccd9683b9c04bdbe253e29f59637fae61c508b62142e0c45b6dea',
    );
  });

  it('includes recipient-aware purchase functions, events, and errors', () => {
    const checkout = abiFunction('checkout');
    const mintDirectSaleBatch = abiFunction('mintDirectSaleBatch');
    const buyBatch = abiFunction('buyBatch');
    const mintDirectSale = abiEvent('MintDirectSale');
    const sold = abiEvent('Sold');
    const checkoutItemProcessed = abiEvent('CheckoutItemProcessed');
    const checkoutCompleted = abiEvent('CheckoutCompleted');
    const recipientCannotBeZero = rareErc1155MarketplaceAbi.find(
      (entry) => entry.type === 'error' && entry.name === 'RecipientCannotBeZero',
    );

    expect(checkout.inputs.map((input) => input.type)).toEqual(['address', 'tuple[]']);
    expect(toFunctionSelector(checkout)).toBe('0x42230aba');
    expect(mintDirectSaleBatch.inputs.map((input) => input.type)).toEqual(['address', 'address', 'address', 'tuple[]']);
    expect(toFunctionSelector(mintDirectSaleBatch)).toBe('0xa2d44e32');
    expect(buyBatch.inputs.map((input) => input.type)).toEqual(['address', 'address', 'address', 'address', 'tuple[]']);
    expect(toFunctionSelector(buyBatch)).toBe('0x1b19ab9b');

    expect(indexedNames(mintDirectSale)).toEqual(['contractAddress', 'payer', 'recipient']);
    expect(toEventSelector(mintDirectSale)).toBe('0x23c89c6f5d0cd9be5a7565f18698cd630d645e8619bc0ff59c713c83d1119771');
    expect(indexedNames(sold)).toEqual(['payer', 'contractAddress', 'recipient']);
    expect(toEventSelector(sold)).toBe('0x857740d63aaa9598f8360ee80e7eb51d65b40b9cd2c7cfa85743bb160df9cb19');
    expect(indexedNames(checkoutItemProcessed)).toEqual(['contractAddress', 'payer', 'recipient']);
    expect(toEventSelector(checkoutItemProcessed)).toBe('0xc543452f20854d5a1a0323a9ece90c2520c81824ed0cc5ebd55398431c620863');
    expect(indexedNames(checkoutCompleted)).toEqual(['payer', 'recipient']);
    expect(toEventSelector(checkoutCompleted)).toBe('0x384a07e434e0109f1045112635ac5be1b6679f33db53df02cdcd159fcf1c4c12');
    expect(recipientCannotBeZero).toBeDefined();
  });
});

function abiFunction(name: string): AbiFunction {
  const entry = rareErc1155MarketplaceAbi.find(
    (candidate) => candidate.type === 'function' && candidate.name === name,
  ) as AbiFunction | undefined;
  if (entry === undefined) {
    throw new Error(`${name} ABI function is missing.`);
  }
  return entry;
}

function abiEvent(name: string): AbiEvent {
  const entry = rareErc1155MarketplaceAbi.find(
    (candidate) => candidate.type === 'event' && candidate.name === name,
  ) as AbiEvent | undefined;
  if (entry === undefined) {
    throw new Error(`${name} ABI event is missing.`);
  }
  return entry;
}

function indexedNames(event: AbiEvent): string[] {
  return event.inputs
    .filter((input) => input.indexed)
    .map((input) => input.name ?? '');
}
