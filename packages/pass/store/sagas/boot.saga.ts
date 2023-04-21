import { call, put, select, takeLeading } from 'redux-saga/effects';

import { authentication } from '@proton/pass/auth/authentication';
import { PassCrypto } from '@proton/pass/crypto';
import { PassCryptoHydrationError } from '@proton/pass/crypto/utils/errors';
import type { Maybe, RequiredNonNull } from '@proton/pass/types';
import { logger } from '@proton/pass/utils/logger';
import { merge } from '@proton/pass/utils/object';

import { boot, bootFailure, bootSuccess, stateSync } from '../actions';
import type { UserState } from '../reducers';
import { selectSessionLockToken } from '../selectors';
import type { State, WorkerRootSagaOptions } from '../types';
import getCachedState, { type ExtensionCache } from './workers/cache';
import { SyncType, type SynchronizationResult, synchronize } from './workers/sync';
import { getUserData } from './workers/user';

function* bootWorker({ onBoot }: WorkerRootSagaOptions) {
    try {
        const sessionLockToken: Maybe<string> = yield select(selectSessionLockToken);
        const cache: Maybe<ExtensionCache> = yield getCachedState(sessionLockToken);
        const currentState: State = yield select();
        const state = cache?.state ? merge(currentState, cache.state, { excludeEmpty: true }) : currentState;

        logger.info(`[Saga::Boot] ${cache !== undefined ? 'Booting from cache' : 'Cache not found during boot'}`);

        const { user, tier, addresses, eventId }: RequiredNonNull<UserState> = yield getUserData(state);

        yield call(PassCrypto.hydrate, {
            user,
            keyPassword: authentication.getPassword(),
            addresses: Object.values(addresses),
            snapshot: cache?.snapshot,
        });

        /* hydrate the background store from cache - see `reducers/index.ts` */
        yield put(stateSync(state, { receiver: 'background' }));

        /* trigger a partial synchronization */
        const sync = (yield synchronize(state, SyncType.PARTIAL)) as SynchronizationResult;
        yield put(bootSuccess({ user, tier, addresses, eventId, sync }));

        onBoot?.({ ok: true });
    } catch (error: unknown) {
        logger.warn('[Saga::Boot]', error);
        yield put(bootFailure(error));

        onBoot?.({
            ok: false,
            clearCache: error instanceof PassCryptoHydrationError,
        });
    }
}

export default function* watcher(options: WorkerRootSagaOptions) {
    yield takeLeading(boot.match, bootWorker, options);
}