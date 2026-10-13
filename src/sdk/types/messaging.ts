import type { RareAuthRequestOptions } from './account.js';
import type { MessagingSession, MessagingInbox, MessagingSearchPerson, MessagingCreateDirect, MessagingCreatedDirect, MessagingCreateRoom, MessagingConversation, MessagingPage, MessagingChanges, MessagingParticipants, MessagingSend, MessagingMessage, MessagingCommand, MessagingMessageCommand, MessagingUser, MessagingDraftPreview, MessagingAttachment, MessagingPublicResolveContext, MessagingPublicRoom, MessagingPublicPage, MessagingPublicSend, MessagingPublicMessage } from '../messaging-core.js';
export type * from '../messaging-core.js';
export type MessagingImageOptions = RareAuthRequestOptions & { contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; width: number; height: number; uploadId?: string };
/** Durable messaging uses the account session. Mutations are not automatically retried. */
export type PublicMessagingClient = {
  resolveRoom: (context: MessagingPublicResolveContext, options?: RareAuthRequestOptions) => Promise<MessagingPublicRoom>;
  history: (roomId: string, options?: RareAuthRequestOptions & { before?: string; after?: string; limit?: number }) => Promise<MessagingPublicPage>;
};
export type RareMessagingClient = {
  sendPublic: (roomId: string, input: MessagingPublicSend, options?: RareAuthRequestOptions) => Promise<MessagingPublicMessage>;
  session: (options?: RareAuthRequestOptions) => Promise<MessagingSession>;
  inbox: (options?: RareAuthRequestOptions & { search?: string; cursor?: string }) => Promise<MessagingInbox>;
  people: (search: string, options?: RareAuthRequestOptions) => Promise<MessagingSearchPerson[]>;
  createDirect: (input: MessagingCreateDirect, options?: RareAuthRequestOptions) => Promise<MessagingCreatedDirect>;
  createRoom: (input: MessagingCreateRoom, options?: RareAuthRequestOptions) => Promise<MessagingConversation>;
  history: (conversationId: string, options?: RareAuthRequestOptions & { before?: string; pinned?: boolean }) => Promise<MessagingPage>;
  changes: (conversationId: string, after: string, options?: RareAuthRequestOptions) => Promise<MessagingChanges>;
  participants: (conversationId: string, options?: RareAuthRequestOptions & { after?: string; search?: string }) => Promise<MessagingParticipants>;
  send: (conversationId: string, input: MessagingSend, options?: RareAuthRequestOptions) => Promise<MessagingMessage>;
  command: (conversationId: string, input: MessagingCommand, options?: RareAuthRequestOptions) => Promise<MessagingConversation>;
  messageCommand: (conversationId: string, messageId: string, input: MessagingMessageCommand, options?: RareAuthRequestOptions) => Promise<MessagingMessage>;
  blocks: (options?: RareAuthRequestOptions) => Promise<MessagingUser[]>;
  block: (userId: string, options?: RareAuthRequestOptions) => Promise<void>;
  unblock: (userId: string, options?: RareAuthRequestOptions) => Promise<void>;
  preview: (conversationId: string, url: string, options?: RareAuthRequestOptions) => Promise<MessagingDraftPreview>;
  uploadImage: (conversationId: string, file: Uint8Array | Blob, options: MessagingImageOptions) => Promise<MessagingAttachment>;
  readImage: (attachmentId: string, options?: RareAuthRequestOptions) => Promise<Blob>;
};
