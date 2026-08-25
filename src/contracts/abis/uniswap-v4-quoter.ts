export const uniswapV4QuoterAbi = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          {
            name: 'poolKey',
            type: 'tuple',
            components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ],
          },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'exactAmount', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'quoteExactOutputSingle',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          {
            name: 'poolKey',
            type: 'tuple',
            components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ],
          },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'exactAmount', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'quoteExactInput',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'exactCurrency', type: 'address' },
          {
            name: 'path',
            type: 'tuple[]',
            components: [
              { name: 'intermediateCurrency', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
              { name: 'hookData', type: 'bytes' },
            ],
          },
          { name: 'exactAmount', type: 'uint128' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }, { name: 'gasEstimate', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'quoteExactOutput',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'exactCurrency', type: 'address' },
          {
            name: 'path',
            type: 'tuple[]',
            components: [
              { name: 'intermediateCurrency', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
              { name: 'hookData', type: 'bytes' },
            ],
          },
          { name: 'exactAmount', type: 'uint128' },
        ],
      },
    ],
    outputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'gasEstimate', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
] as const;
