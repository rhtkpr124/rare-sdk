import type { RareAuthRequestOptions } from './account.js';
import type { MessagingSession, MessagingInbox, MessagingSearchPerson, MessagingCreateDirect, MessagingCreatedDirect, MessagingCreateRoom, MessagingConversation, MessagingPage, MessagingChanges, MessagingParticipants, MessagingSend, MessagingMessage, MessagingCommand, MessagingMessageCommand, MessagingUser, MessagingDraftPreview, MessagingAttachment, MessagingPublicResolveContext, MessagingPublicRoom, MessagingPublicPage, MessagingPublicSend, MessagingPublicMessage } from '../messaging-core.js';
export type * from '../messaging-core.js';
export type MessagingImageOptions = { width: number; height: number; attachmentId?: string; purpose?: 'message' | 'conversation' };
/** Durable messaging uses the account session. Mutations are not automatically retried. */
export type PublicMessagingClient = {
  resolveRoom: (context: MessagingPublicResolveContext, options?: RareAuthRequestOptions) => Promise<MessagingPublicRoom>;
  history: (roomId: string, input?: { before?: string; after?: string; limit?: number }, options?: RareAuthRequestOptions) => Promise<MessagingPublicPage>;
};
export type RareMessagingClient = {
  public: {
    history: (roomId: string, input?: { before?: string; after?: string; limit?: number }, options?: RareAuthRequestOptions & { authenticated?: boolean }) => Promise<MessagingPublicPage>;
    send: (roomId: string, input: MessagingPublicSend, options?: RareAuthRequestOptions) => Promise<MessagingPublicMessage>;
  };
  session: (options?: RareAuthRequestOptions) => Promise<MessagingSession>;
  inbox: (input?: { search?: string; cursor?: string }, options?: RareAuthRequestOptions) => Promise<MessagingInbox>;
  people: (search: string, options?: RareAuthRequestOptions) => Promise<MessagingSearchPerson[]>;
  createDirect: (input: MessagingCreateDirect, options?: RareAuthRequestOptions) => Promise<MessagingCreatedDirect>;
  createRoom: (input: MessagingCreateRoom, options?: RareAuthRequestOptions) => Promise<MessagingConversation>;
  history: (conversationId: string, input?: { before?: string; pinned?: boolean }, options?: RareAuthRequestOptions) => Promise<MessagingPage>;
  changes: (conversationId: string, after: string, options?: RareAuthRequestOptions) => Promise<MessagingChanges>;
  participants: (conversationId: string, input?: { after?: string; search?: string }, options?: RareAuthRequestOptions) => Promise<MessagingParticipants>;
  send: (conversationId: string, input: MessagingSend, options?: RareAuthRequestOptions) => Promise<MessagingMessage>;
  command: (conversationId: string, input: MessagingCommand, options?: RareAuthRequestOptions) => Promise<MessagingConversation>;
  messageCommand: (conversationId: string, messageId: string, input: MessagingMessageCommand, options?: RareAuthRequestOptions) => Promise<MessagingMessage>;
  blocks: (options?: RareAuthRequestOptions) => Promise<MessagingUser[]>;
  block: (userId: string, options?: RareAuthRequestOptions) => Promise<void>;
  unblock: (userId: string, options?: RareAuthRequestOptions) => Promise<void>;
  preview: (conversationId: string, url: string, options?: RareAuthRequestOptions) => Promise<MessagingDraftPreview>;
  attachImage: (conversationId: string, uploadId: string, input: MessagingImageOptions, options?: RareAuthRequestOptions) => Promise<MessagingAttachment>;
  readImage: (attachmentId: string, options?: RareAuthRequestOptions) => Promise<Blob>;
};
