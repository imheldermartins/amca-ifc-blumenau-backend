export interface PageAccessAuthorizer {
  canAccessPage(userId: string, pageId: string): Promise<boolean>;
}

export type DeferredTaskScheduler = (task: () => void) => void;
