import { setTimeout as delay } from 'node:timers/promises';
import { RareAuthError } from '../../src/sdk/account-auth-core.js';
import { privateKeyToAccount } from 'viem/accounts';
import { createRareAccountClient } from '../../src/sdk/account-client.js';
import { isPrivateKeyString } from '../../src/sdk/validation.js';

export const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

export const messagingOrigin = (): string => {
  const url = new URL(required('RARE_ACCOUNT_TEST_API_URL'));
  if (url.protocol !== 'https:' || url.hostname === 'api.superrare.com' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Use a non-production HTTPS API origin');
  if (process.env.RARE_API_BASE_URL && process.env.RARE_API_BASE_URL !== url.origin) throw new Error('RARE_API_BASE_URL must match RARE_ACCOUNT_TEST_API_URL');
  return url.origin;
};

export const loginMessagingActor = async (name: string) => {
  const key = required(name);
  if (!isPrivateKeyString(key)) throw new Error(`Invalid ${name}`);
  const wallet = privateKeyToAccount(key);
  const account = createRareAccountClient({ apiBaseUrl: messagingOrigin() });
  await account.auth.loginWithWallet({ address: wallet.address, chainId: 1, signMessage: message => wallet.signMessage({ message }) });
  try {
    const session = await account.messaging.session();
    return { account, user: session.user };
  } catch (error) {
    await account.auth.logout();
    throw error;
  }
};

export type MessagingActor = Awaited<ReturnType<typeof loginMessagingActor>>;

export const withMessagingActors = async (operation: (owner: MessagingActor, member: MessagingActor, outsider: MessagingActor) => Promise<void>): Promise<void> => {
  const owner = await loginMessagingActor('RARE_ACCOUNT_TEST_PRIVATE_KEY');
  try {
    const member = await loginMessagingActor('RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY');
    try {
      const outsider = await loginMessagingActor('RARE_ACCOUNT_TEST_THIRD_PRIVATE_KEY');
      try {
        if (new Set([owner.user.id, member.user.id, outsider.user.id]).size !== 3) throw new Error('Use three distinct existing test accounts');
        await operation(owner, member, outsider);
      } finally { await outsider.account.auth.logout(); }
    } finally { await member.account.auth.logout(); }
  } finally { await owner.account.auth.logout(); }
};

/** Retry only the public sender cooldown; callers retain the same message input. */
export const retryPublicSend = async <T>(send: () => Promise<T>, retries = 2): Promise<T> => {
  try { return await send(); } catch (error) {
    if (!(error instanceof RareAuthError) || error.status !== 429 || error.code !== 'rate_limited' || retries === 0) throw error;
    await delay(1100);
    return retryPublicSend(send, retries - 1);
  }
};
