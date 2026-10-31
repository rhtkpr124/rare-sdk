import { z } from "zod";
import { getAddress, isAddress } from "viem";
const address = z
  .string()
  .refine((value) => isAddress(value), "Invalid Ethereum address")
  .transform((value) => getAddress(value));
const identifier = z.string().regex(/^[1-9][0-9]*$/);
const chainId = z.number().int().positive().safe();
const chainIdWire = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform(Number)
  .pipe(chainId);
const tokenId = z.string().regex(/^(0|[1-9][0-9]*)$/);
const calculation = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("PERCENTAGE"),
    basisPoints: z.number().int().min(0).max(10000),
    currencyMode: z.literal("COMPONENT_CURRENCY"),
  }),
  z.object({
    type: z.enum(["FIXED", "PER_UNIT"]),
    amount: z
      .bigint()
      .positive()
      .max((1n << 256n) - 1n),
    currencyMode: z.literal("COMPONENT_CURRENCY"),
  }),
]);
const scope = z
  .object({
    chainIds: z.array(chainId).optional(),
    sellerAddresses: z.array(address).optional(),
    skus: z.array(z.string().regex(/^0x[0-9a-fA-F]{64}$/)).optional(),
    nfts: z
      .array(
        z.object({
          chainId,
          contract: address,
          tokenId: z
            .bigint()
            .nonnegative()
            .max((1n << 256n) - 1n),
        }),
      )
      .min(1)
      .max(1000)
      .optional(),
    collections: z
      .array(z.object({ chainId, contract: address }))
      .min(1)
      .max(1000)
      .optional(),
    productIds: z.array(identifier).optional(),
    fulfillmentKinds: z.array(z.number().int().min(0).max(5)).optional(),
    saleTypes: z.array(z.enum(["PRIMARY_SALE", "SECONDARY_SALE"])).optional(),
    settlementCurrencies: z.array(address).optional(),
    paymentCurrencies: z.array(address).optional(),
  })
  .strict();
const configuration = z
  .object({
    phase: z.enum(["LISTING_CONFIGURATION", "CHECKOUT"]),
    code: z.string().regex(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/),
    calculation,
    recipient: z.discriminatedUnion("type", [
      z.object({ type: z.literal("FIXED"), address }),
      z.object({ type: z.literal("TOKEN_CREATOR") }),
    ]),
    scope: scope.default({}),
    priority: z.number().int().min(0).max(2147483647),
    validFrom: z.string().datetime({ offset: true }).nullable().optional(),
    validUntil: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();
export type CartFeeCreateParams = z.input<typeof configuration>;
export type CartFee = z.output<typeof configuration> & {
  id: string;
  ruleId: string;
  chargeSku: `0x${string}`;
};
export type CartFeeListParams = {
  phase?: "LISTING_CONFIGURATION" | "CHECKOUT";
  page?: number;
  perPage?: number;
};
export type CartFeeRequestOptions = { signal?: AbortSignal };
export type CartFeesNamespace = {
  create: (
    input: CartFeeCreateParams,
    options?: CartFeeRequestOptions,
  ) => Promise<CartFee>;
  list: (
    input?: CartFeeListParams,
    options?: CartFeeRequestOptions,
  ) => Promise<{
    data: CartFee[];
    pagination: { page: number; perPage: number; hasNextPage: boolean };
  }>;
  disable: (
    id: string,
    options?: CartFeeRequestOptions,
  ) => Promise<{ id: string; disabled: boolean }>;
};
const serializeFeeConfiguration = (fee: z.output<typeof configuration>) => ({
  ...fee,
  calculation:
    fee.calculation.type === "PERCENTAGE"
      ? fee.calculation
      : { ...fee.calculation, amount: fee.calculation.amount.toString() },
  scope: {
    ...fee.scope,
    ...(fee.scope.chainIds === undefined
      ? {}
      : { chainIds: fee.scope.chainIds.map(String) }),
    ...(fee.scope.collections === undefined
      ? {}
      : {
          collections: fee.scope.collections.map((value) => ({
            ...value,
            chainId: String(value.chainId),
          })),
        }),
    ...(fee.scope.nfts === undefined
      ? {}
      : {
          nfts: fee.scope.nfts.map((value) => ({
            ...value,
            chainId: String(value.chainId),
            tokenId: String(value.tokenId),
          })),
        }),
  },
});
type CartFeeWire = ReturnType<typeof serializeFeeConfiguration>;
export const planCartFeeCreate = (
  input: CartFeeCreateParams,
): { ok: true; value: CartFeeWire } | { ok: false; message: string } => {
  const invalid = (message: string): { ok: false; message: string } => ({
    ok: false,
    message,
  });
  const scope = input.scope ?? {};
  const calculation = input.calculation;
  const validChain = (value: number): boolean =>
    Number.isSafeInteger(value) && value > 0;
  const validAddress = (value: string): boolean => isAddress(value);
  const validArray = <Value>(
    values: readonly Value[] | undefined,
    predicate: (value: Value) => boolean,
  ): boolean => values === undefined || values.every(predicate);
  if (input.phase !== "LISTING_CONFIGURATION" && input.phase !== "CHECKOUT")
    return invalid("Invalid fee phase.");
  if (!/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(input.code))
    return invalid("Invalid fee code.");
  if (
    !Number.isSafeInteger(input.priority) ||
    input.priority < 0 ||
    input.priority > 2147483647
  )
    return invalid("Fee priority must be a nonnegative database integer.");
  if (calculation.currencyMode !== "COMPONENT_CURRENCY")
    return invalid("Fees must use component-currency base units.");
  if (calculation.type === "PERCENTAGE") {
    if (
      !Number.isInteger(calculation.basisPoints) ||
      calculation.basisPoints < 0 ||
      calculation.basisPoints > 10000
    )
      return invalid("Fee basis points must be between 0 and 10000.");
  } else if (
    (calculation.type !== "FIXED" && calculation.type !== "PER_UNIT") ||
    typeof calculation.amount !== "bigint" ||
    calculation.amount <= 0n ||
    calculation.amount > (1n << 256n) - 1n
  )
    return invalid(
      "Fixed and per-unit fees require a positive uint256 bigint amount.",
    );
  if (input.recipient.type === "FIXED") {
    if (!validAddress(input.recipient.address))
      return invalid("Invalid fee recipient.");
  } else if (input.recipient.type !== "TOKEN_CREATOR")
    return invalid("Invalid fee recipient type.");
  if (
    !validArray(scope.chainIds, validChain) ||
    !validArray(scope.sellerAddresses, validAddress) ||
    !validArray(scope.settlementCurrencies, validAddress) ||
    !validArray(scope.paymentCurrencies, validAddress)
  )
    return invalid("Invalid fee chain or currency scope.");
  if (
    !validArray(scope.skus, (value) => /^0x[0-9a-fA-F]{64}$/.test(value)) ||
    !validArray(scope.productIds, (value) => /^[1-9][0-9]*$/.test(value)) ||
    !validArray(
      scope.fulfillmentKinds,
      (value) => Number.isInteger(value) && value >= 0 && value <= 5,
    ) ||
    !validArray(
      scope.saleTypes,
      (value) => value === "PRIMARY_SALE" || value === "SECONDARY_SALE",
    )
  )
    return invalid("Invalid item fee scope.");
  if (
    scope.collections !== undefined &&
    (scope.collections.length < 1 ||
      scope.collections.length > 1000 ||
      !scope.collections.every(
        (value) => validChain(value.chainId) && validAddress(value.contract),
      ))
  )
    return invalid("Invalid collection fee scope.");
  if (
    scope.nfts !== undefined &&
    (scope.nfts.length < 1 ||
      scope.nfts.length > 1000 ||
      !scope.nfts.every(
        (value) =>
          validChain(value.chainId) &&
          validAddress(value.contract) &&
          typeof value.tokenId === "bigint" &&
          value.tokenId >= 0n &&
          value.tokenId <= (1n << 256n) - 1n,
      ))
  )
    return invalid("Invalid NFT fee scope.");
  for (const value of [input.validFrom, input.validUntil])
    if (
      value !== undefined &&
      value !== null &&
      (!/^\d{4}-\d{2}-\d{2}T/.test(value) ||
        !Number.isFinite(Date.parse(value)))
    )
      return invalid("Fee validity requires an ISO timestamp.");
  if (
    input.validFrom != null &&
    input.validUntil != null &&
    Date.parse(input.validUntil) <= Date.parse(input.validFrom)
  )
    return invalid("validUntil must follow validFrom.");
  if (
    input.phase === "CHECKOUT" &&
    (scope.nfts !== undefined ||
      scope.collections !== undefined ||
      scope.skus !== undefined ||
      scope.productIds !== undefined ||
      scope.sellerAddresses !== undefined ||
      scope.fulfillmentKinds !== undefined ||
      scope.saleTypes !== undefined)
  )
    return invalid("Item-specific overrides require LISTING_CONFIGURATION.");
  const fee: z.output<typeof configuration> = {
    ...input,
    recipient:
      input.recipient.type === "FIXED"
        ? { type: "FIXED", address: getAddress(input.recipient.address) }
        : input.recipient,
    scope: {
      chainIds: scope.chainIds,
      skus: scope.skus,
      productIds: scope.productIds,
      fulfillmentKinds: scope.fulfillmentKinds,
      saleTypes: scope.saleTypes,
      sellerAddresses: scope.sellerAddresses?.map((value) => getAddress(value)),
      settlementCurrencies: scope.settlementCurrencies?.map((value) =>
        getAddress(value),
      ),
      paymentCurrencies: scope.paymentCurrencies?.map((value) =>
        getAddress(value),
      ),
      collections: scope.collections?.map((value) => ({
        ...value,
        contract: getAddress(value.contract),
      })),
      nfts: scope.nfts?.map((value) => ({
        ...value,
        contract: getAddress(value.contract),
      })),
    },
  };
  return { ok: true, value: serializeFeeConfiguration(fee) };
};
const wireCalculation = z.discriminatedUnion("type", [
  calculation.options[0],
  z.object({
    type: z.enum(["FIXED", "PER_UNIT"]),
    amount: tokenId.transform(BigInt),
    currencyMode: z.literal("COMPONENT_CURRENCY"),
  }),
]);
const wireScope = scope.extend({
  chainIds: z.array(chainIdWire).optional(),
  collections: z
    .array(z.object({ chainId: chainIdWire, contract: address }))
    .optional(),
  nfts: z
    .array(
      z.object({
        chainId: chainIdWire,
        contract: address,
        tokenId: tokenId.transform(BigInt).pipe(
          z
            .bigint()
            .nonnegative()
            .max((1n << 256n) - 1n),
        ),
      }),
    )
    .optional(),
});
const feeSchema = configuration.extend({
  calculation: wireCalculation,
  scope: wireScope,
  id: identifier,
  ruleId: identifier,
  chargeSku: z.custom<`0x${string}`>(
    (input) => typeof input === "string" && /^0x[0-9a-f]{64}$/.test(input),
  ),
});
export const parseCartFee = (input: unknown): CartFee => feeSchema.parse(input);
export const parseCartFeePage = (input: unknown) =>
  z.object({ data: z.array(feeSchema), hasNextPage: z.boolean() }).parse(input);
export const planCartFeeList = (
  input: CartFeeListParams,
): {
  phase?: "LISTING_CONFIGURATION" | "CHECKOUT";
  page: number;
  perPage: number;
} => {
  const page = input.page ?? 1,
    perPage = input.perPage ?? 20;
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(perPage) ||
    perPage < 1 ||
    perPage > 100
  )
    throw new Error("Invalid fee pagination.");
  if (
    input.phase !== undefined &&
    input.phase !== "LISTING_CONFIGURATION" &&
    input.phase !== "CHECKOUT"
  )
    throw new Error("Invalid fee phase.");
  return { ...input, page, perPage };
};
export const parseCartFeeId = (input: string): string => {
  if (!/^[1-9][0-9]*$/.test(input))
    throw new Error("Invalid fee assignment ID.");
  return input;
};
export const parseCartFeeDisabled = (input: unknown) =>
  z.object({ id: identifier, disabled: z.literal(true) }).parse(input);
