import { c } from 'ttag';

import type { CreateNotificationOptions } from '@proton/components/containers';
import { SESSION_LOCK_CODE } from '@proton/pass/lib/api/utils';
import type { Maybe, MaybeNull, MaybePromise } from '@proton/pass/types';
import { type Api, SessionLockStatus } from '@proton/pass/types';
import { pipe, tap } from '@proton/pass/utils/fp/pipe';
import { asyncLock } from '@proton/pass/utils/fp/promises';
import { withCallCount } from '@proton/pass/utils/fp/with-call-count';
import { logger } from '@proton/pass/utils/logger';
import { getEpoch } from '@proton/pass/utils/time/epoch';
import { revoke } from '@proton/shared/lib/api/auth';
import { getApiError, getApiErrorMessage, getIs401Error } from '@proton/shared/lib/api/helpers/apiErrorHelper';
import { queryUnlock } from '@proton/shared/lib/api/user';
import { PASS_APP_NAME } from '@proton/shared/lib/constants';
import { srpAuth } from '@proton/shared/lib/srp';
import noop from '@proton/utils/noop';

import { type RefreshSessionData } from '../api/refresh';
import {
    type ConsumeForkPayload,
    type RequestForkOptions,
    type RequestForkResult,
    consumeFork,
    requestFork,
} from './fork';
import {
    type AuthSession,
    type PersistedAuthSession,
    encryptPersistedSession,
    encryptPersistedSessionWithKey,
    isValidSession,
    resumeSession,
} from './session';
import type { SessionLock } from './session-lock';
import {
    checkSessionLock,
    createSessionLock,
    deleteSessionLock,
    forceSessionLock,
    unlockSession,
} from './session-lock';
import { type AuthStore } from './store';

export type AuthResumeOptions = {
    /** `forceLock` will locally lock the session upon resuming */
    forceLock?: boolean;
    /** If `true`, session resuming should be retried */
    retryable?: boolean;
};

export interface AuthServiceConfig {
    api: Api;
    /** Store holding the active session data */
    authStore: AuthStore;
    /** The in-memory session is used to store the session data securely.
     * It allows resuming a session without any API calls to re-authenticate.
     * In most cases you can omit the implementation and rely on the `authStore` */
    getMemorySession?: () => MaybePromise<any>;
    /** The persisted session will be parsed and decrypted to extract the
     * session data. Requires an API call to retrieve the local key. */
    getPersistedSession: (localID: Maybe<number>) => MaybePromise<MaybeNull<PersistedAuthSession>>;
    /**  Implement any service initialization logic in this hook. Should return
     * a boolean flag indicating wether user was authorized or not. */
    onInit: (options: AuthResumeOptions) => Promise<boolean>;
    /** Called when authorization sequence starts: this can happen when consuming a
     * session fork or when trying to resume a session. */
    onAuthorize?: () => void;
    /** Called whenever a user is successfully authenticated. This can happen
     * after consuming a fork or resuming a session.  */
    onAuthorized?: (userID: string, localID: Maybe<number>) => void;
    /** Called whenever a user is unauthenticated. This will be triggered any time
     * the `logout` function is called (either via user action or when an inactive
     * session is detected). The `broadcast` flag indicates wether we should
     * broadcast the unauthorized session to other clients. */
    onUnauthorized?: (userID: Maybe<string>, localID: Maybe<number>, broadcast: boolean) => void;
    /** Called immediately after a fork has been successfully consumed. At this
     * point the user is not fully logged in yet. */
    onForkConsumed?: (session: AuthSession, state: string) => MaybePromise<void>;
    /** Called when a fork could not be successfully consumed. This can happen
     * if the fork data is invalid */
    onForkInvalid?: () => void;
    /** Handle the result of a fork request call. Can be used to redirect the
     * user automatically when requesting a fork from account. */
    onForkRequest?: (result: RequestForkResult) => void;
    /** Called when an invalid persistent session error is thrown during a
     * session resuming sequence. */
    onSessionInvalid?: () => void;
    /* Called when no persisted session or in-memory session can be used to
     * resume a session. */
    onSessionEmpty?: () => void;
    /** Called when a session is locked either through user action or when a
     * locked session is detected. The `broadcast` flag indicates wether we should
     * broadcast the locked session to other clients. */
    onSessionLocked?: (localID: Maybe<number>, broadcast: boolean) => void;
    /** Callback when session lock is created, updated or deleted */
    onSessionLockUpdate?: (data: SessionLock) => void;
    /** Called with the `sessionLockToken` when session is successfully unlocked */
    onSessionUnlocked?: (sessionLockToken: string) => void;
    /** Implement encrypted local session persistence using this hook. Called on every
     * successful consumed fork or unlocked session. */
    onSessionPersist?: (encryptedSession: string) => MaybePromise<void>;
    /** Called when resuming the session failed for any reason excluding inactive
     * session error. */
    onSessionResumeFailure?: (options: AuthResumeOptions) => void;
    /** Called when session tokens have been refreshed. The`broadcast` flag indicates
     * wether we should broadcast the refresh session data to other clients. */
    onSessionRefresh?: (localId: Maybe<number>, data: RefreshSessionData, broadcast: boolean) => MaybePromise<void>;
    /** Implement how you want to handle notifications emitted from the service */
    onNotification?: (notification: CreateNotificationOptions) => void;
}

export const createAuthService = (config: AuthServiceConfig) => {
    const { api, authStore } = config;

    const authService = {
        init: asyncLock(async (options: AuthResumeOptions) => {
            logger.info(`[AuthService] Initialization start`);
            return config.onInit(options).catch((err) => {
                logger.warn(`[AuthService] Initialization failure`, err);
                return false;
            });
        }),

        /** Stores the initial configuration object passed to the
         * auth service factory function. Useful if you want to trigger
         * certain handlers outside of the auth service flow. */
        config,

        /** Removes any ongoing API listeners and starts listening for
         * authentication relevant API messages.*/
        listen: () => {
            api.unsubscribe();
            api.subscribe((event) => {
                switch (event.type) {
                    case 'session': {
                        api.unsubscribe();

                        if (event.status === 'inactive') {
                            config.onNotification?.({
                                text: c('Warning').t`Your session is inactive. Please log back in.`,
                            });
                            return authService.logout({ soft: true, broadcast: true });
                        }

                        if (event.status === 'locked') {
                            config.onNotification?.({ text: c('Warning').t`Your session was locked.` });
                            return authService.lock({ soft: true, broadcast: true });
                        }

                        break;
                    }

                    case 'refresh': {
                        const { data } = event;
                        authStore.setAccessToken(data.AccessToken);
                        authStore.setRefreshToken(data.RefreshToken);
                        authStore.setUID(data.UID);
                        authStore.setRefreshTime(data.RefreshTime);
                        void config.onSessionRefresh?.(authStore.getLocalID(), data, true);
                    }
                }
            });
        },

        login: async (session: AuthSession) => {
            config.onAuthorize?.();

            authStore.setUID(session.UID);
            authStore.setUserID(session.UserID);
            authStore.setLocalID(session.LocalID);
            authStore.setPassword(session.keyPassword);
            authStore.setLockToken(session.sessionLockToken);
            authStore.setAccessToken(session.AccessToken);
            authStore.setRefreshToken(session.RefreshToken);
            authStore.setRefreshTime(session.RefreshTime);

            authService.listen();

            try {
                const lockStatus = authStore.getLockStatus() ?? (await authService.checkLock()).status;

                if (lockStatus === SessionLockStatus.LOCKED) {
                    logger.info(`[AuthService] Detected locked session`);
                    await authService.lock({ soft: true, broadcast: false });
                    return false;
                }

                if (lockStatus === SessionLockStatus.REGISTERED && !session.sessionLockToken) {
                    logger.info(`[AuthService] Detected a registered session lock`);
                    await authService.lock({ soft: true, broadcast: false });
                    return false;
                }
            } catch (error: any) {
                /* if there is an API error on `checkSessionLock` we want to logout
                 * the user only if it is due to a 401 or 403 status response */
                if (getIs401Error(error) || getApiError(error).status === 403) {
                    void authService.logout({ soft: true, broadcast: true });
                    return false;
                }
            }

            logger.info(`[AuthService] User is authorized`);
            config.onAuthorized?.(authStore.getUserID()!, authStore.getLocalID());

            return true;
        },

        logout: async (options: { soft: boolean; broadcast?: boolean }) => {
            logger.info(`[AuthService] User is not authorized`);

            const localID = authStore.getLocalID();
            const userID = authStore.getUserID();

            if (!options?.soft) void api({ ...revoke(), silent: true }).catch(noop);

            authStore.clear();
            api.unsubscribe();
            await api.reset();

            authService.resumeSession.resetCount();
            config.onUnauthorized?.(userID, localID, options.broadcast ?? true);

            return true;
        },

        consumeFork: async (payload: ConsumeForkPayload, apiUrl?: string): Promise<boolean> => {
            try {
                config.onAuthorize?.();
                const session = await consumeFork({ api, payload, apiUrl });
                await config.onForkConsumed?.(session, payload.state);

                const loggedIn = await authService.login(session);
                if (loggedIn) await authService.persistSession();

                return loggedIn;
            } catch (error: unknown) {
                const reason = error instanceof Error ? ` (${getApiErrorMessage(error) ?? error?.message})` : '';
                config.onNotification?.({ text: c('Warning').t`Your session could not be authorized.` + reason });
                config.onForkInvalid?.();
                await authService.logout({ soft: true, broadcast: false });

                return false;
            }
        },

        requestFork: (options: RequestForkOptions): RequestForkResult => {
            const result = requestFork(options);
            config.onForkRequest?.(result);

            return result;
        },

        /** Creates a session lock. Automatically updates the authentication
         * store and immediately persists the session on success. */
        createLock: async (lockCode: string, ttl: number) => {
            const sessionLockToken = await createSessionLock(lockCode, ttl);

            authStore.setLockToken(sessionLockToken);
            authStore.setLockTTL(ttl);
            authStore.setLockStatus(SessionLockStatus.REGISTERED);
            config.onSessionLockUpdate?.({ status: SessionLockStatus.REGISTERED, ttl });

            void authService.persistSession();
        },

        /** Deletes a registered session lock. Requires the session lock code.
         * Immediately persists the session on success. */
        deleteLock: async (lockCode: string) => {
            await deleteSessionLock(lockCode);

            authStore.setLockToken(undefined);
            authStore.setLockTTL(undefined);
            authStore.setLockStatus(SessionLockStatus.NONE);
            config.onSessionLockUpdate?.({ status: SessionLockStatus.NONE });

            void authService.persistSession();
        },

        lock: async (options: { soft: boolean; broadcast?: boolean }): Promise<void> => {
            if (authStore.getLockStatus() === SessionLockStatus.LOCKED) return;

            logger.info(`[AuthService] Locking session [soft: ${options.soft}]`);
            if (!options?.soft) await forceSessionLock().catch(noop);

            api.unsubscribe();
            authStore.setLockStatus(SessionLockStatus.LOCKED);
            authStore.setLockToken(undefined);
            authStore.setLockLastExtendTime(undefined);

            config.onSessionLocked?.(authStore.getLocalID(), options.broadcast ?? false);
        },

        unlock: async (pin: string): Promise<void> => {
            try {
                logger.info(`[AuthService] Unlocking session`);

                await api.reset();
                authService.listen();

                const sessionLockToken = await unlockSession(pin).catch(async (error) => {
                    /** When unlocking the session, if the lock was unregistered by
                     * another client we will hit a 400 response with the 300008 response
                     * code. At this point we can login the user without requiring to unlock.
                     * FIXME: BE should reply a custom error code. */
                    const { code, status } = getApiError(error);
                    if (code === SESSION_LOCK_CODE && status === 400) {
                        config.onNotification?.({
                            text: c('Error').t`Your PIN code was removed by another ${PASS_APP_NAME} client`,
                            expiration: -1,
                        });
                        return undefined;
                    }
                    throw error;
                });

                authStore.setLockToken(sessionLockToken);

                await authService.checkLock();
                await authService.persistSession();
                await authService.login(authStore.getSession());

                if (sessionLockToken) config.onSessionUnlocked?.(sessionLockToken);
            } catch (error: unknown) {
                /* if the session is inactive at this point, it likely means the user
                 * reached the maximum amount of unlock attempts. Error is thrown so
                 * clients can react. */
                if (api.getState().sessionInactive) void authService.logout({ soft: true, broadcast: true });
                else void authService.lock({ soft: true, broadcast: false });

                throw error;
            }
        },

        /* Calling this function when a lock is registered and active
         * will extend the lock by resetting the ttl server-side */
        checkLock: async () => {
            logger.info('[AuthService] Checking session lock status');
            const lock = await checkSessionLock();

            authStore.setLockStatus(lock.status);
            authStore.setLockTTL(lock.ttl);
            authStore.setLockLastExtendTime(getEpoch());

            config.onSessionLockUpdate?.(lock);
            return lock;
        },

        persistSession: async () => {
            try {
                logger.info('[AuthService] Persisting session');

                const session = authStore.getSession();
                if (!isValidSession(session)) throw new Error('Trying to persist invalid session');

                const encryptedSession = await encryptPersistedSession(api, session);
                await config.onSessionPersist?.(encryptedSession);
            } catch (error) {
                logger.warn(`[AuthService] Persisting session failure`, error);
            }
        },

        resumeSession: withCallCount(
            pipe(
                async (localID: Maybe<number>, options: AuthResumeOptions): Promise<boolean> => {
                    const memorySession = await config.getMemorySession?.();

                    if (memorySession && isValidSession(memorySession)) {
                        logger.info(`[Worker::Auth] Resuming in-memory session`);
                        return authService.login(memorySession);
                    }

                    try {
                        const persistedSession = await config.getPersistedSession(localID);

                        if (!persistedSession) {
                            logger.info(`[AuthService] No persisted session found`);
                            config.onSessionEmpty?.();
                            return false;
                        }

                        logger.info(`[AuthService] Resuming persisted session.`);
                        config.onAuthorize?.();

                        /** Partially configure the auth store before resume sequence.
                         * `keyPassword` and `sessionLockToken` are still encrypted at
                         * this point */
                        authStore.setUserID(persistedSession.UserID);
                        authStore.setUID(persistedSession.UID);
                        authStore.setLocalID(persistedSession.LocalID);
                        authStore.setAccessToken(persistedSession.AccessToken);
                        authStore.setRefreshToken(persistedSession.RefreshToken);
                        authStore.setRefreshTime(persistedSession.RefreshTime);

                        /* Start listening for API errors before resuming the session in order
                         * to gracefully handle inactive session errors during this sequence */
                        authService.listen();

                        const { session, sessionKey } = await resumeSession({
                            api,
                            authStore,
                            persistedSession,
                            onSessionInvalid: config.onSessionInvalid,
                        });

                        logger.info(`[AuthService] Session successfuly resumed`);

                        /* on `forceLock: true` remove the `sessionLockToken` from the
                         * session result to trigger an auth lock during the login sequence.
                         * Re-persist the session without the `sessionLockToken` in order
                         * to ensure the `forceLock` effect propagates to future resumes. */
                        if (session.sessionLockToken && options?.forceLock) {
                            logger.info(`[AuthService] Force lock requested `);
                            delete session.sessionLockToken;
                            const sanitizedPS = await encryptPersistedSessionWithKey(session, sessionKey);
                            await config?.onSessionPersist?.(sanitizedPS);
                        }

                        return await authService.login(session);
                    } catch (error: unknown) {
                        if (error instanceof Error) {
                            const reason = ` (${getApiErrorMessage(error) ?? error?.message})`;
                            logger.warn(`[AuthService] Resuming session failed ${reason}`);
                            config.onNotification?.({
                                text: c('Warning').t`Your session could not be resumed.` + reason,
                            });
                        }

                        /* if session is inactive : trigger unauthorized sequence */
                        if (api.getState().sessionInactive) await authService.logout({ soft: true, broadcast: true });
                        else config.onSessionResumeFailure?.(options);

                        return false;
                    }
                },
                tap((resumed) => {
                    /** Reset the internal resume session count when session
                     * resuming succeeds */
                    if (resumed) authService.resumeSession.resetCount();
                })
            )
        ),

        confirmPassword: (password: string): Promise<boolean> =>
            srpAuth({ api, credentials: { password }, config: { ...queryUnlock(), silence: true } })
                .then(() => true)
                .catch((error) => {
                    if (error instanceof Error) {
                        config.onNotification?.({ text: getApiErrorMessage(error) ?? error?.message });
                    }

                    return false;
                }),
    };

    return authService;
};

export type AuthService = ReturnType<typeof createAuthService>;
